import {
  SEARCH_RUN_STATUSES,
  type SearchRunStatus,
} from "../../domain/buyers/types.js";

const TERMINAL_SEARCH_RUN_STATUSES = new Set<SearchRunStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);

const ALLOWED_TRANSITIONS: Record<SearchRunStatus, readonly SearchRunStatus[]> = {
  QUEUED: ["PLANNING", "CANCELLED", "FAILED", "INTERRUPTED"],
  PLANNING: ["RESEARCHING", "CANCELLED", "FAILED", "INTERRUPTED"],
  RESEARCHING: ["VERIFYING", "CANCELLED", "FAILED", "INTERRUPTED"],
  VERIFYING: ["SAVING", "CANCELLED", "FAILED", "INTERRUPTED"],
  SAVING: ["COMPLETED", "CANCELLED", "FAILED", "INTERRUPTED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  INTERRUPTED: [],
};

export class InvalidSearchRunTransitionError extends Error {
  readonly code = "INVALID_SEARCH_RUN_TRANSITION";

  constructor(
    readonly currentStatus: SearchRunStatus,
    readonly nextStatus: SearchRunStatus,
  ) {
    super(`Cannot transition buyer search run from ${currentStatus} to ${nextStatus}.`);
    this.name = "InvalidSearchRunTransitionError";
  }
}

export function isSearchRunStatus(value: unknown): value is SearchRunStatus {
  return typeof value === "string" && SEARCH_RUN_STATUSES.includes(value as SearchRunStatus);
}

export function isTerminalSearchRunStatus(status: SearchRunStatus): boolean {
  return TERMINAL_SEARCH_RUN_STATUSES.has(status);
}

export function canTransitionSearchRun(
  currentStatus: SearchRunStatus,
  nextStatus: SearchRunStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertSearchRunTransition(
  currentStatus: SearchRunStatus,
  nextStatus: SearchRunStatus,
): void {
  if (!canTransitionSearchRun(currentStatus, nextStatus)) {
    throw new InvalidSearchRunTransitionError(currentStatus, nextStatus);
  }
}

export function getSearchRunStage(status: SearchRunStatus): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PLANNING":
      return "Preparing search";
    case "RESEARCHING":
      return "Searching sources";
    case "VERIFYING":
      return "Verifying candidates";
    case "SAVING":
      return "Saving results";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "INTERRUPTED":
      return "Interrupted";
  }
}
