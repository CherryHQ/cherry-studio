import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useEffect } from 'react'

const logger = loggerService.withContext('useAgentSessionInitializer')

/**
 * On startup, if no active session is set, pick the most-recently-ordered one
 * and seed `agent.active_session_id`. The list endpoint already returns
 * sessions sorted by `(orderKey, id)` ASC and `createSession` inserts at
 * position `'first'`, so the first item is what the user touched most
 * recently (or the first pinned one — pinning floats above otherwise).
 */
export const useAgentSessionInitializer = () => {
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')

  useEffect(() => {
    if (activeSessionId) return
    let cancelled = false
    ;(async () => {
      try {
        const { items: sessions } = await dataApiService.get('/sessions', { query: { limit: 1 } })
        if (cancelled) return
        if (sessions.length > 0) setActiveSessionId(sessions[0].id)
      } catch (error) {
        logger.error('Failed to seed active session', error as Error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSessionId, setActiveSessionId])
}
