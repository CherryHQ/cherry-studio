/**
 * Per-service ceiling for `onStop()` / `onDestroy()` during shutdown. On expiry
 * the framework logs and moves on to the next service, so one stuck teardown
 * cannot starve the ones queued behind it.
 *
 * Only `stopAll()` / `destroyAll()` arm it. The runtime `stop()` / `restart()`
 * paths keep their unbounded wait — see `LifecycleManager.stopSingle`.
 */
export const SERVICE_STOP_TIMEOUT_MS = 5000

/**
 * Ceiling for the whole shutdown() sequence. Like every timer-based bound here,
 * it only applies to teardown that yields to the event loop — a synchronously
 * blocking onStop() defeats this one too.
 *
 * A healthy shutdown finishes in well under a second and never approaches this.
 * It guarantees that ONE — or a few — services stuck in async waits cannot
 * starve the rest. It does NOT guarantee the per-service mechanism always runs
 * to completion: six services each exhausting their own SERVICE_STOP_TIMEOUT_MS
 * is enough to reach it, and stopAll() + destroyAll() share the budget. Past
 * that point truncation is the right call — the app is already in a bad state.
 */
export const SHUTDOWN_TIMEOUT_MS = 30_000
