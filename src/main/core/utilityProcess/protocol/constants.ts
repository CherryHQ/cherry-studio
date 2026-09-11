/**
 * Wire-protocol constants shared by the main-side host and the child runtime.
 * Child-safe: this module must never import main-only singletons.
 */

export const PROTOCOL = 'cherry.utility-process'
export const PROTOCOL_VERSION = 1

/** Spawn → `ready` deadline. Fixed by design: heavy work belongs in handlers, not `initialize`. */
export const READY_TIMEOUT_MS = 10_000
/** `stop()` sends `shutdown`, then `kill()`s after this grace window. */
export const STOP_GRACE_MS = 1_000
/** `stop()` gives up (PROCESS_STOP_FAILED) once this much time passes without an observed exit. */
export const STOP_TOTAL_MS = 4_000
/** Per-line cap for the stdout/stderr fallback channel. */
export const STDIO_LINE_CAP = 64 * 1024

/** `serviceName` prefix — the correlation key in `app.getAppMetrics()` and `child-process-gone`. */
export const SERVICE_NAME_PREFIX = 'CherryStudio.UtilityProcess.'

/** `code` on the AbortError a handler's `signal` receives when its request is cancelled. */
export const REQUEST_CANCELLED_CODE = 'UTILITY_PROCESS_REQUEST_CANCELLED'
/** `code` on the AbortError a handler's `signal` receives when the process is shutting down. */
export const SHUTDOWN_CODE = 'UTILITY_PROCESS_SHUTDOWN'

/** Child self-exit codes; main treats any of them as an exit, the code only enriches diagnostics. */
export const CHILD_EXIT_CODES = {
  badConnect: 70,
  startupFailed: 71,
  protocolViolation: 72,
  uncaught: 73
} as const

/** After reporting a startup/protocol failure the child waits this long for main's kill before exiting itself. */
export const CHILD_SELF_EXIT_DELAY_MS = 1_000
