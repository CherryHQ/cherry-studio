import type { JobManager } from '@main/core/job/JobManager'

/**
 * Wait until JobManager's per-queue Layer 1 mutex is free for every known
 * queue, i.e. no dispatch transaction is currently in flight.
 *
 * Background: JobManager fires `void this.dispatch(queue)` from finalizeJob —
 * after `await handle.finished` resolves the caller, that follow-up tx is
 * still in flight against libsql. If the next operation (or the next test's
 * truncate) hits db.transaction before it completes, libsql client-ts raises
 * SQLITE_BUSY (upstream issue #288: busy_timeout not effective for async
 * transactions).
 *
 * Polling the queue mutex is more reliable than a fixed sleep — once the
 * mutex is free, the trailing tx has truly committed and a follow-up write
 * is safe.
 */
export async function drainTrailingDispatch(jobManager: JobManager): Promise<void> {
  const queues: Map<string, { mutex: { acquire: () => Promise<() => void> } }> = (
    jobManager as unknown as { queues: typeof queues }
  ).queues
  for (const q of queues.values()) {
    const release = await q.mutex.acquire()
    release()
  }
  // Plus a microtask flush so any queueMicrotask-scheduled follow-ups land.
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
}
