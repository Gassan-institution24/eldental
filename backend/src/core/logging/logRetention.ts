/** Retention defaults in seconds (15_LOGGING_AND_MONITORING.md §4). Enforced with TTL indexes. */
const DAY = 24 * 60 * 60;
export const LOG_RETENTION = {
  requestLogs: 30 * DAY,
  activityLogs: 180 * DAY,
  clientIssues: 365 * DAY,
  systemErrorsAfterResolve: 365 * DAY,
} as const;
