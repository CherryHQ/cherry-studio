/**
 * Shutdown grace period (ms) — the hard deadline the composition root
 * (`Application`) arms as a force-exit safety net around graceful shutdown
 * (`LifecycleManager.stopAll`), and that shutdown participants (e.g. `JobManager`
 * draining in-flight jobs) honor as their drain budget.
 *
 * It is a shared shutdown-timing policy, so it lives with the lifecycle shutdown
 * mechanism rather than as a static on the `Application` class — keeping any
 * participant from importing the whole `Application` class just to read a scalar.
 */
export const SHUTDOWN_TIMEOUT_MS = 5000
