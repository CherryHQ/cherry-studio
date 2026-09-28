import { useCallback } from 'react'

import { cacheService } from '@data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import type { AssistantModelSettingsPatch, AssistantSettings } from '@shared/data/types/assistant'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

const FALLBACK_ASSISTANT_KEY = '__none__'

function getReasoningEffortPendingKey(assistantId: string): UseCacheKey {
  return `chat.assistant.reasoning_effort_pending.${assistantId}`
}

function getServiceTierPendingKey(assistantId: string): UseCacheKey {
  return `chat.assistant.service_tier_pending.${assistantId}`
}

function getSettingsPatchPendingKey(assistantId: string): UseCacheKey {
  return `chat.assistant.settings_patch_pending.${assistantId}`
}

function useAssistantPendingSetting<T>(
  assistantId: string | null | undefined,
  getKey: (id: string) => UseCacheKey,
  canonical: T
) {
  const cacheKey = getKey(assistantId ?? FALLBACK_ASSISTANT_KEY)
  const [pending, setPending] = useCache(cacheKey)

  const effective = assistantId && pending ? pending.value : canonical

  const startPending = useCallback(
    (value: T): number => {
      if (!assistantId) return 0
      setPending((current) => {
        const version = (current?.version ?? 0) + 1
        return { value, version }
      })
      const stored = cacheService.get(cacheKey) as { version: number } | undefined
      return stored?.version ?? 0
    },
    [assistantId, cacheKey, setPending]
  )

  const finishPending = useCallback(
    (version: number) => {
      setPending((current) => (current?.version === version ? null : current))
    },
    [setPending]
  )

  return { effective, startPending, finishPending }
}

export function useAssistantPendingReasoningEffort(
  assistantId: string | null | undefined,
  canonicalReasoningEffort: ReasoningEffortOption
) {
  return useAssistantPendingSetting(assistantId, getReasoningEffortPendingKey, canonicalReasoningEffort)
}

export function useAssistantPendingServiceTier(
  assistantId: string | null | undefined,
  canonicalServiceTier: ServiceTierSelection
) {
  return useAssistantPendingSetting(assistantId, getServiceTierPendingKey, canonicalServiceTier)
}

export function useAssistantPendingSettingsPatch(
  assistantId: string | null | undefined,
  canonicalSettings: AssistantSettings | undefined
) {
  const cacheKey = getSettingsPatchPendingKey(assistantId ?? FALLBACK_ASSISTANT_KEY)
  const [pending, setPending] = useCache(cacheKey)

  const pendingPatch = assistantId && pending ? pending.patch : undefined
  const effectiveSettings =
    canonicalSettings && pendingPatch ? { ...canonicalSettings, ...pendingPatch } : canonicalSettings

  const startPending = useCallback(
    (patch: AssistantModelSettingsPatch): number => {
      if (!assistantId) return 0
      setPending((current) => {
        const version = (current?.version ?? 0) + 1
        return {
          patch: { ...current?.patch, ...patch },
          version
        }
      })
      const stored = cacheService.get(cacheKey) as { version: number } | undefined
      return stored?.version ?? 0
    },
    [assistantId, cacheKey, setPending]
  )

  const finishPending = useCallback(
    (version: number) => {
      setPending((current) => (current?.version === version ? null : current))
    },
    [setPending]
  )

  return { effectiveSettings, pendingPatch, startPending, finishPending }
}
