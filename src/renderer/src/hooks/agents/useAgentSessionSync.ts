/**
 * Watches the `agent_session.cache_version` shared cache key (bumped by Main
 * after auto-rename via TopicNamingService) and invalidates every agent-session
 * SWR cache entry so list + detail UIs pick up the new name on next render.
 *
 * Mirrors the `topic.cache_version` pattern. Trades the legacy surgical
 * IPC patch for a refetch — fine because session renames are rare.
 */

import { useSharedCache } from '@data/hooks/useCache'
import { useEffect, useRef } from 'react'
import { mutate } from 'swr'

// Matches both fixed string keys (`/v1/agents/{agentId}/sessions[/{id}]`) and
// the serialized infinite key (`["/v1/agents/{agentId}/sessions",page,size]`),
// while excluding message-scoped keys (`/sessions/{id}/messages...`).
const SESSION_KEY_RE = /\/agents\/[^/"]+\/sessions(\/[^/"]+)?(?:"|$)/

function isSessionKey(key: unknown): boolean {
  if (typeof key === 'string') return SESSION_KEY_RE.test(key)
  if (Array.isArray(key) && typeof key[0] === 'string') return SESSION_KEY_RE.test(key[0])
  return false
}

export function useAgentSessionSync() {
  const [version] = useSharedCache('agent_session.cache_version')
  const lastSeenRef = useRef(version)

  useEffect(() => {
    if (version === lastSeenRef.current) return
    lastSeenRef.current = version
    void mutate(isSessionKey)
  }, [version])
}
