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

// Matches the flat session list (`/sessions`) and detail (`/sessions/{id}`),
// excluding message-scoped keys (`/sessions/{id}/messages...`). Works against
// both string keys and the serialized infinite-query key (which embeds the
// path as the first array element wrapped in quotes).
const SESSION_KEY_RE = /\/sessions(?:\/[^/"]+)?(?:"|$)/
const MESSAGES_KEY_RE = /\/sessions\/[^/"]+\/messages/

function isSessionKey(key: unknown): boolean {
  const path = typeof key === 'string' ? key : Array.isArray(key) && typeof key[0] === 'string' ? key[0] : null
  if (!path) return false
  return SESSION_KEY_RE.test(path) && !MESSAGES_KEY_RE.test(path)
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
