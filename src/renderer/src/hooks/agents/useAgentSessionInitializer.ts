import { useQuery } from '@data/hooks/useDataApi'
import { useCache } from '@renderer/data/hooks/useCache'
import { useEffect, useState } from 'react'

/**
 * On startup, if no active session is set, pick the most-recently-ordered one
 * once and seed `agent.active_session_id`. The list endpoint already returns
 * sessions sorted by `(orderKey, id)` ASC and `createSession` inserts at
 * position `'first'`, so the first item is what the user touched most
 * recently (or the first pinned one — pinning floats above otherwise).
 *
 * This intentionally does not keep re-filling the pointer after the first
 * initialization pass. A null active session can be a deliberate UI state
 * (for example, the agent page's blank "choose an agent first" new-session
 * flow), not just an uninitialized app.
 *
 * Read via `useQuery` (SWR-deduped) instead of a raw `dataApiService.get`
 * inside an effect — multiple windows on first launch would otherwise each
 * fire a fetch and stomp each other's `setActiveSessionId` write.
 */
export const useAgentSessionInitializer = () => {
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const [hasInitialized, setHasInitialized] = useState(() => Boolean(activeSessionId))
  const shouldInitialize = !hasInitialized && !activeSessionId
  const { data } = useQuery('/sessions', {
    query: { limit: 1 },
    enabled: shouldInitialize
  })

  useEffect(() => {
    if (activeSessionId) {
      setHasInitialized(true)
    }
  }, [activeSessionId])

  useEffect(() => {
    if (!shouldInitialize || !data) return
    const first = data?.items?.[0]?.id
    if (first) setActiveSessionId(first)
    setHasInitialized(true)
  }, [data, setActiveSessionId, shouldInitialize])
}
