import { useCallback } from 'react'

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

type SettingsPatchPending = {
  patch: AssistantModelSettingsPatch
  version: number
  contributions: Record<number, AssistantModelSettingsPatch>
}

function mergeSettingsPatchContributions(
  contributions: Record<number, AssistantModelSettingsPatch>
): AssistantModelSettingsPatch {
  const versions = Object.keys(contributions)
    .map(Number)
    .sort((a, b) => a - b)
  let patch: AssistantModelSettingsPatch = {}
  for (const version of versions) {
    patch = { ...patch, ...contributions[version] }
  }
  return patch
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
      let version = 0
      setPending((current) => {
        version = (current?.version ?? 0) + 1
        return { value, version }
      })
      return version
    },
    [assistantId, setPending]
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
      let version = 0
      setPending((current: SettingsPatchPending | null) => {
        version = (current?.version ?? 0) + 1
        const contributions = { ...current?.contributions, [version]: patch }
        return {
          patch: mergeSettingsPatchContributions(contributions),
          version,
          contributions
        }
      })
      return version
    },
    [assistantId, setPending]
  )

  const finishPending = useCallback(
    (version: number) => {
      setPending((current: SettingsPatchPending | null) => {
        if (!current?.contributions?.[version]) {
          return current?.version === version ? null : current
        }
        const nextContributions = { ...current.contributions }
        delete nextContributions[version]
        const remainingVersions = Object.keys(nextContributions)
        if (remainingVersions.length === 0) return null
        const nextVersion = Math.max(...remainingVersions.map(Number))
        return {
          patch: mergeSettingsPatchContributions(nextContributions),
          version: nextVersion,
          contributions: nextContributions
        }
      })
    },
    [setPending]
  )

  return { effectiveSettings, pendingPatch, startPending, finishPending }
}
