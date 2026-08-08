import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('agentSessionWarmth')

/**
 * Grace period before a released session's warm query is actually closed.
 * Absorbs <Activity> tab switches, where the session UI unmounts on hide and
 * remounts on show within moments.
 */
const CLOSE_WARM_DELAY_MS = 10_000

const retainCounts = new Map<string, number>()
const pendingCloses = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Refcounted keep-warm for an agent session's backend warm query.
 *
 * Retain while the session UI is mounted; the returned release (idempotent)
 * schedules `close_warm` only after {@link CLOSE_WARM_DELAY_MS} with no
 * re-retain, and `prewarm` is only sent when the session is actually cold —
 * so hide/show cycles cost zero IPC instead of a close/prewarm round-trip each.
 */
export function retainAgentSessionWarmth(sessionId: string): () => void {
  const pendingClose = pendingCloses.get(sessionId)
  if (pendingClose) {
    clearTimeout(pendingClose)
    pendingCloses.delete(sessionId)
  }
  const nextCount = (retainCounts.get(sessionId) ?? 0) + 1
  retainCounts.set(sessionId, nextCount)
  // A canceled pending close means the backend is still warm — skip prewarm.
  if (nextCount === 1 && !pendingClose) {
    void ipcApi.request('ai.agent.session.prewarm', { sessionId }).catch((error) => {
      logger.warn('Failed to prewarm agent session', error as Error)
    })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const count = retainCounts.get(sessionId) ?? 0
    if (count > 1) {
      retainCounts.set(sessionId, count - 1)
      return
    }
    retainCounts.delete(sessionId)
    const timer = setTimeout(() => {
      pendingCloses.delete(sessionId)
      void ipcApi.request('ai.agent.session.close_warm', { sessionId }).catch((error) => {
        logger.warn('Failed to close agent session warm query', error as Error)
      })
    }, CLOSE_WARM_DELAY_MS)
    pendingCloses.set(sessionId, timer)
  }
}
