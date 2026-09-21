const LEVEL_TO_CONSOLE_METHOD = {
  INFO: "log",
  WARN: "warn",
  ERROR: "error",
};

export function createBuyerPipelineLogger({ consoleImplementation = console, now = () => new Date().toISOString() } = {}) {
  return {
    event(event) {
      const level = normalizeLevel(event.level);
      const record = {
        timestamp: now(),
        scope: "buyer-finder",
        runId: event.runId,
        level,
        eventType: event.eventType,
        message: event.message,
        ...(event.details && Object.keys(event.details).length > 0 ? { details: event.details } : {}),
      };
      consoleImplementation[LEVEL_TO_CONSOLE_METHOD[level]](JSON.stringify(record));
    },
  };
}

function normalizeLevel(level) {
  return level === "WARN" || level === "ERROR" ? level : "INFO";
}
