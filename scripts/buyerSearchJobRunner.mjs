import { isTerminalSearchRunStatus } from "../dist/application/buyerDiscovery/index.js";

export function createBuyerSearchJobRunner({
  repository,
  execute,
  concurrency = 1,
  now = () => new Date().toISOString(),
  recoverStaleRuns = true,
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
      await repository.transitionSearchRun(runId, "PLANNING", { now: now() });

      const context = {
        runId,
        signal: controller.signal,
        getRun: () => repository.getSearchRun(runId),
        transition: (status, changes = {}) => repository.transitionSearchRun(runId, status, {
          ...changes,
          now: changes.now ?? now(),
        }),
        updateProgress: (progress) => repository.updateSearchRunProgress(runId, progress, now()),
        updateTelemetry: (telemetry) => repository.updateSearchRunTelemetry(runId, telemetry, now()),
      };

      await execute(context);

      const run = await repository.getSearchRun(runId);

      if (!run || isTerminalSearchRunStatus(run.status)) {
        return;
      }

      if (run.status === "SAVING") {
        await repository.transitionSearchRun(runId, "COMPLETED", { now: now() });
        return;
      }

      await repository.transitionSearchRun(runId, "FAILED", {
        now: now(),
        errorCode: "JOB_INCOMPLETE",
        errorMessage: `Buyer search worker stopped during ${run.status}.`,
      });
    } catch (error) {
      const run = await repository.getSearchRun(runId);

      if (run && !isTerminalSearchRunStatus(run.status)) {
        await repository.transitionSearchRun(runId, controller.signal.aborted ? "CANCELLED" : "FAILED", {
          now: now(),
          errorCode: controller.signal.aborted ? "CANCELLED_BY_USER" : safeErrorCode(error),
          errorMessage: controller.signal.aborted
            ? "The buyer search was cancelled by the user."
            : safeErrorMessage(error),
        });
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
