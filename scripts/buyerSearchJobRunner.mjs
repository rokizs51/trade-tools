import { isTerminalSearchRunStatus } from "../dist/application/buyerDiscovery/index.js";

export function createBuyerSearchJobRunner({
  repository,
  execute,
  concurrency = 1,
  now = () => new Date().toISOString(),
  recoverStaleRuns = true,
  logger,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Buyer search job concurrency must be a positive integer.");
  }

  const ready = recoverStaleRuns
    ? Promise.resolve(repository.interruptStaleSearchRuns(now()))
    : Promise.resolve();

  const queue = [];
  const queuedIds = new Set();
  const running = new Map();
  const idleWaiters = new Set();
  let pumpScheduled = false;

  async function enqueue(runId) {
    await ready;
    const run = await repository.getSearchRun(runId);

    if (!run) {
      throw new Error(`Cannot queue missing buyer search run ${runId}.`);
    }

    if (run.status !== "QUEUED") {
      throw new Error(`Only QUEUED buyer searches can be enqueued; ${runId} is ${run.status}.`);
    }

    if (queuedIds.has(runId) || running.has(runId)) {
      return false;
    }

    queue.push(runId);
    queuedIds.add(runId);
    schedulePump();
    return true;
  }

  async function cancel(runId) {
    await ready;
    const run = await repository.getSearchRun(runId);

    if (!run || isTerminalSearchRunStatus(run.status)) {
      return false;
    }

    if (queuedIds.delete(runId)) {
      const index = queue.indexOf(runId);

      if (index >= 0) {
        queue.splice(index, 1);
      }

      await repository.transitionSearchRun(runId, "CANCELLED", {
        now: now(),
        errorCode: "CANCELLED_BY_USER",
        errorMessage: "The buyer search was cancelled before it started.",
      });
      await recordEvent(runId, {
        level: "WARN",
        eventType: "SEARCH_CANCELLED",
        message: "Search was cancelled before it started.",
      });
      settleIdleWaiters();
      return true;
    }

    const active = running.get(runId);

    if (!active) {
      return false;
    }

    await repository.transitionSearchRun(runId, "CANCELLED", {
      now: now(),
      errorCode: "CANCELLED_BY_USER",
      errorMessage: "The buyer search was cancelled by the user.",
    });
    await recordEvent(runId, {
      level: "WARN",
      eventType: "SEARCH_CANCELLED",
      message: "Search was cancelled while it was running.",
    });
    active.controller.abort(new Error("Buyer search cancelled by user."));
    return true;
  }

  async function onIdle() {
    await ready;

    if (queue.length === 0 && running.size === 0) {
      return;
    }

    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  function getSnapshot() {
    return {
      concurrency,
      queuedRunIds: [...queue],
      runningRunIds: [...running.keys()],
    };
  }

  function schedulePump() {
    if (pumpScheduled) {
      return;
    }

    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function pump() {
    while (running.size < concurrency && queue.length > 0) {
      const runId = queue.shift();
      queuedIds.delete(runId);
      const controller = new AbortController();
      running.set(runId, { controller });
      void executeJob(runId, controller);
    }

    settleIdleWaiters();
  }

  async function executeJob(runId, controller) {
    try {
      await transition(runId, "PLANNING", { now: now() });

      let lastProgressEvent = "";
      const context = {
        runId,
        signal: controller.signal,
        getRun: () => repository.getSearchRun(runId),
        transition: (status, changes = {}) => transition(runId, status, changes),
        updateProgress: async (progress) => {
          const updated = await repository.updateSearchRunProgress(runId, progress, now());
          const key = `${progress.stage ?? ""}:${progress.current}:${progress.total}`;
          if (key !== lastProgressEvent && (progress.current === 0 || progress.current === progress.total)) {
            lastProgressEvent = key;
            await recordEvent(runId, {
              eventType: "SEARCH_PROGRESS",
              message: progress.stage ?? "Search progress updated.",
              details: { current: progress.current, total: progress.total },
            });
          }
          return updated;
        },
        updateTelemetry: (telemetry) => repository.updateSearchRunTelemetry(runId, telemetry, now()),
        recordEvent: (event) => recordEvent(runId, event),
      };

      await execute(context);

      const run = await repository.getSearchRun(runId);

      if (!run || isTerminalSearchRunStatus(run.status)) {
        return;
      }

      if (run.status === "SAVING") {
        await transition(runId, "COMPLETED", { now: now() });
        return;
      }

      await transition(runId, "FAILED", {
        now: now(),
        errorCode: "JOB_INCOMPLETE",
        errorMessage: `Buyer search worker stopped during ${run.status}.`,
      });
    } catch (error) {
      const run = await repository.getSearchRun(runId);

      if (run && !isTerminalSearchRunStatus(run.status)) {
        const cancelled = controller.signal.aborted;
        await transition(runId, cancelled ? "CANCELLED" : "FAILED", {
          now: now(),
          errorCode: cancelled ? "CANCELLED_BY_USER" : safeErrorCode(error),
          errorMessage: cancelled
            ? "The buyer search was cancelled by the user."
            : safeErrorMessage(error),
        });
        if (!cancelled) {
          await recordEvent(runId, {
            level: "ERROR",
            eventType: "SEARCH_FAILED",
            message: "Search stopped because a pipeline stage failed.",
            details: { errorCode: safeErrorCode(error) },
          });
        }
      }
    } finally {
      running.delete(runId);
      pump();
    }
  }

  function settleIdleWaiters() {
    if (queue.length > 0 || running.size > 0) {
      return;
    }

    for (const resolve of idleWaiters) {
      resolve();
    }

    idleWaiters.clear();
  }

  return { enqueue, cancel, onIdle, getSnapshot };

  async function transition(runId, status, changes = {}) {
    const updated = await repository.transitionSearchRun(runId, status, {
      ...changes,
      now: changes.now ?? now(),
    });
    await recordEvent(runId, {
      level: ["FAILED", "CANCELLED", "INTERRUPTED"].includes(status) ? "WARN" : "INFO",
      eventType: "STATUS_CHANGED",
      message: `Search status changed to ${status.toLowerCase()}.`,
      details: { status, stage: updated.currentStage },
    });
    return updated;
  }

  async function recordEvent(runId, event) {
    const payload = {
      level: event.level ?? "INFO",
      eventType: event.eventType,
      message: event.message,
      ...(event.details ? { details: event.details } : {}),
    };
    try {
      logger?.event({ runId, ...payload });
      if (typeof repository.recordSearchEvent === "function") {
        await repository.recordSearchEvent(runId, payload, { now: now() });
      }
    } catch (error) {
      logger?.event({
        runId,
        level: "ERROR",
        eventType: "EVENT_LOG_WRITE_FAILED",
        message: "Could not persist a Buyer Finder event.",
        details: { errorCode: safeErrorCode(error) },
      });
    }
  }
}

function safeErrorMessage(error) {
  let current = error;
  let fallback;
  let depth = 0;

  while (current instanceof Error && depth < 6) {
    fallback ??= current.message;

    if (typeof current.code === "string") {
      return current.message;
    }

    current = current.cause;
    depth += 1;
  }

  return fallback ?? "Buyer search job failed.";
}

function safeErrorCode(error) {
  let current = error;
  let depth = 0;

  while (current && typeof current === "object" && depth < 6) {
    if (typeof current.code === "string") {
      return current.code;
    }

    current = current.cause;
    depth += 1;
  }

  return "JOB_FAILED";
}
