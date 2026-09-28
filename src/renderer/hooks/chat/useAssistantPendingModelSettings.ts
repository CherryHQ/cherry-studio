import { useCallback } from 'react'

import { cacheService } from '@data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import type { CacheAssistantSettingsPatchPending } from '@shared/data/cache/cacheValueTypes'
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

function buildPatchFromFields(
  fields: CacheAssistantSettingsPatchPending['fields'] | undefined
): AssistantModelSettingsPatch {
  if (!fields) return {}
  return Object.fromEntries(Object.entries(fields).flatMap(([key, entry]) => (entry ? [[key, entry.value]] : [])))
}

function mergePatchFields(
  current: CacheAssistantSettingsPatchPending | null | undefined,
  patch: AssistantModelSettingsPatch,
  version: number
): CacheAssistantSettingsPatchPending {
  const fields: Record<string, { value: unknown; version: number }> = { ...current?.fields }
  for (const key of Object.keys(patch) as Array<keyof AssistantModelSettingsPatch>) {
    const value = patch[key]
    if (value !== undefined) {
      fields[key] = { value, version }
    }
  }
  return { version, fields }
}

function removePatchFieldsForVersion(
  current: CacheAssistantSettingsPatchPending,
  version: number
): CacheAssistantSettingsPatchPending | null {
  const fields = { ...current.fields }
  for (const key of Object.keys(fields)) {
    if (fields[key]?.version === version) {
      delete fields[key]
    }
  }
  const remainingVersions = Object.values(fields)
    .map((entry) => entry?.version ?? 0)
    .filter((entryVersion) => entryVersion > 0)
  if (remainingVersions.length === 0) return null
  return {
    fields,
    version: Math.max(...remainingVersions)
  }
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
      const current = cacheService.get(getKey(assistantId))
      const version = (current?.version ?? 0) + 1
      setPending({ value, version })
      return version
    },
    [assistantId, getKey, setPending]
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

  const pendingPatch =
    assistantId && pending && Object.keys(pending.fields).length > 0 ? buildPatchFromFields(pending.fields) : undefined
  const effectiveSettings =
    canonicalSettings && pendingPatch && Object.keys(pendingPatch).length > 0
      ? { ...canonicalSettings, ...pendingPatch }
      : canonicalSettings

  const startPending = useCallback(
    (patch: AssistantModelSettingsPatch): number => {
      if (!assistantId) return 0
      const key = getSettingsPatchPendingKey(assistantId)
      const current = cacheService.get(key) ?? null
      const version = (current?.version ?? 0) + 1
      setPending(mergePatchFields(current, patch, version))
      return version
    },
    [assistantId, setPending]
  )

  const finishPending = useCallback(
    (version: number) => {
      setPending((current) => {
        if (!current) return current
        return removePatchFieldsForVersion(current, version)
      })
    },
    [setPending]
  )

  return { effectiveSettings, pendingPatch, startPending, finishPending }
}
