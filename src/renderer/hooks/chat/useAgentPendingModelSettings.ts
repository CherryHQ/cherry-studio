import { useCallback, useEffect } from 'react'

import { useCache } from '@renderer/data/hooks/useCache'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

const FALLBACK_AGENT_KEY = '__none__'

function getReasoningEffortPendingKey(agentId: string): UseCacheKey {
  return `chat.agent.reasoning_effort_pending.${agentId}`
}

function getServiceTierPendingKey(agentId: string): UseCacheKey {
  return `chat.agent.service_tier_pending.${agentId}`
}

function useAgentPendingSetting<T>(
  agentId: string | null | undefined,
  getKey: (id: string) => UseCacheKey,
  canonical: T
) {
  const cacheKey = getKey(agentId ?? FALLBACK_AGENT_KEY)
  const [pending, setPending] = useCache(cacheKey)

  const effective = agentId && pending ? pending.value : canonical

  useEffect(() => {
    if (!agentId || !pending) return
    if (!Object.is(pending.value, canonical)) return
    setPending((current) =>
      current?.version === pending.version && Object.is(current.value, pending.value) ? null : current
    )
  }, [agentId, canonical, pending, setPending])

  const startPending = useCallback(
    (value: T): number => {
      if (!agentId) return 0
      let version = 0
      setPending((current) => {
        version = (current?.version ?? 0) + 1
        return { value, version }
      })
      return version
    },
    [agentId, setPending]
  )

  const finishPending = useCallback(
    (version: number, failed = false) => {
      if (!failed) return
      setPending((current) => (current?.version === version ? null : current))
    },
    [setPending]
  )

  const clearPending = useCallback(() => {
    setPending(null)
  }, [setPending])

  return { effective, startPending, finishPending, clearPending }
}

export function useAgentPendingReasoningEffort(
  agentId: string | null | undefined,
  canonicalReasoningEffort: ReasoningEffortOption
) {
  return useAgentPendingSetting(agentId, getReasoningEffortPendingKey, canonicalReasoningEffort)
}

export function useAgentPendingServiceTier(
  agentId: string | null | undefined,
  canonicalServiceTier: ServiceTierSelection
) {
  return useAgentPendingSetting(agentId, getServiceTierPendingKey, canonicalServiceTier)
}
