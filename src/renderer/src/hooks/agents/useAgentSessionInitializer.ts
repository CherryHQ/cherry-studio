import { useQuery } from '@data/hooks/useDataApi'
import { useCache } from '@renderer/data/hooks/useCache'
import { useEffect } from 'react'

/**
 * On startup, if no active session is set, pick the most-recently-ordered one
 * and seed `agent.active_session_id`. The list endpoint already returns
 * sessions sorted by `(orderKey, id)` ASC and `createSession` inserts at
 * position `'first'`, so the first item is what the user touched most
 * recently (or the first pinned one — pinning floats above otherwise).
 *
 * Read via `useQuery` (SWR-deduped) instead of a raw `dataApiService.get`
 * inside an effect — multiple windows on first launch would otherwise each
 * fire a fetch and stomp each other's `setActiveSessionId` write.
 */
export const useAgentSessionInitializer = () => {
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const { data } = useQuery('/sessions', {
    query: { limit: 1 },
    enabled: !activeSessionId
  })

  useEffect(() => {
    if (activeSessionId) return
    const first = data?.items?.[0]?.id
    if (first) setActiveSessionId(first)
  }, [activeSessionId, data, setActiveSessionId])
}
