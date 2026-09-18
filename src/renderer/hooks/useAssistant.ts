/**
 * Assistant data layer — three tiers in one module:
 *
 *  1. DataApi tier — raw SQLite-backed queries/mutations
 *     (`useAssistantsApi` / `useAssistantApiById` / `useAssistantMutations`).
 *  2. Composed hooks — `useAssistants` / `useAssistant`.
 *
 * Returns the canonical {@link Assistant} entity straight from SQLite via
 * `/assistants`. No v1 shape adaptation — consumers use the v2 shape
 * directly (`modelId`, `mcpServerIds`, `knowledgeBaseIds`).
 *
 * Companion hooks for the entities Assistant references:
 *  - {@link import('./useTopic').useTopicsByAssistant} for topics
 *  - {@link import('./useModel').useModelById} for the model
 *  - {@link import('./useMcpServer').useMcpServer} for MCP servers
 *  - {@link import('./useKnowledgeBase').useKnowledgeBases} for KBs
 */

import { useCallback, useEffect, useRef } from 'react'

import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import type { Assistant, AssistantSettings } from '@renderer/types/assistant'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/model'
import type { CreateAssistantDto, DeleteAssistantResult, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import type { Model } from '@shared/data/types/model'
import { type UniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('useAssistant')

// ─── Tier 1: raw DataApi queries/mutations ────────────────────────────────

const ASSISTANTS_LIST_LIMIT = 500

const EMPTY_ASSISTANTS: readonly Assistant[] = Object.freeze([])

const ASSISTANTS_REFRESH_KEYS: ConcreteApiPaths[] = ['/assistants', '/assistants/*']

type PendingVersions = Partial<Record<keyof AssistantSettings, number>>

type PendingStaged = {
  seq: number
  previousPending: Partial<AssistantSettings>
  previousVersions: PendingVersions
}

function stagePendingSettings(
  pendingRef: { current: Partial<AssistantSettings> },
  versionsRef: { current: PendingVersions },
  seqRef: { current: number },
  patch: Partial<AssistantSettings>
): PendingStaged {
  const seq = seqRef.current + 1
  seqRef.current = seq
  const previousPending = { ...pendingRef.current }
  const previousVersions = { ...versionsRef.current }
  pendingRef.current = { ...previousPending, ...patch }
  const nextVersions: PendingVersions = { ...previousVersions }
  for (const key of Object.keys(patch) as (keyof AssistantSettings)[]) {
    nextVersions[key] = seq
  }
  versionsRef.current = nextVersions
  return { seq, previousPending, previousVersions }
}

function revertPendingSettings(
  pendingRef: { current: Partial<AssistantSettings> },
  versionsRef: { current: PendingVersions },
  staged: PendingStaged,
  patch: Partial<AssistantSettings>
): void {
  const currentVersions = versionsRef.current
  const nextPending: Partial<AssistantSettings> = { ...pendingRef.current }
  const nextVersions: PendingVersions = { ...currentVersions }
  let pendingChanged = false
  let versionsChanged = false
  for (const key of Object.keys(patch) as (keyof AssistantSettings)[]) {
    // A newer overlapping mutation may have overwritten this key after this
    // PATCH started — keep the fresher value instead of resurrecting stale state.
    if (currentVersions[key] !== staged.seq) continue
    pendingChanged = true
    versionsChanged = true
    if (key in staged.previousPending) {
      ;(nextPending as Record<string, unknown>)[key] = (staged.previousPending as Record<string, unknown>)[key]
    } else {
      delete (nextPending as Record<string, unknown>)[key]
    }
    if (key in staged.previousVersions) {
      ;(nextVersions as Record<string, unknown>)[key] = (staged.previousVersions as Record<string, unknown>)[key]
    } else {
      delete (nextVersions as Record<string, unknown>)[key]
    }
  }
  if (pendingChanged) pendingRef.current = nextPending
  if (versionsChanged) versionsRef.current = nextVersions
}

/**
 * List all assistants from SQLite via DataApi.
 *
 * Returns up to {@link ASSISTANTS_LIST_LIMIT} assistants in a single fetch
 * (matches the schema's hard cap). Paginated UI would need a different
 * consumer.
 */
export function useAssistantsApi(options: { enabled?: boolean } = {}) {
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery('/assistants', {
    enabled: options.enabled ?? true,
    query: { limit: ASSISTANTS_LIST_LIMIT }
  })

  return {
    assistants: data?.items ?? EMPTY_ASSISTANTS,
    total: data?.total ?? 0,
    hasLoaded: data !== undefined,
    isLoading,
    isRefreshing,
    error,
    refetch,
    mutate
  }
}

/**
 * Fetch a single assistant by id from SQLite via DataApi.
 */
export function useAssistantApiById(id: string | undefined) {
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants/:id', {
    params: { id: id ?? '' },
    enabled: !!id,
    swrOptions: { keepPreviousData: false }
  })

  return {
    assistant: data,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Assistant mutations backed by DataApi, with archive commands routed through IpcApi.
 */
export function useAssistantMutations() {
  const invalidate = useInvalidateCache()
  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/assistants', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/assistants/:id', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: restoreTrigger } = useMutation('POST', '/assistants/:id/restore', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const createTriggerRef = useRef(createTrigger)
  const updateTriggerRef = useRef(updateTrigger)
  const restoreTriggerRef = useRef(restoreTrigger)
  createTriggerRef.current = createTrigger
  updateTriggerRef.current = updateTrigger
  restoreTriggerRef.current = restoreTrigger

  const createAssistant = useCallback(async (dto: CreateAssistantDto): Promise<Assistant> => {
    const created = await createTriggerRef.current({ body: dto })
    logger.info('Created assistant', { id: created.id })
    return created
  }, [])

  const updateAssistant = useCallback(async (id: string, dto: UpdateAssistantDto): Promise<Assistant> => {
    if (!id) {
      throw new Error('updateAssistant called with empty id; refusing to issue PATCH /assistants/')
    }
    const updated = await updateTriggerRef.current({ params: { id }, body: dto })
    logger.info('Updated assistant', { id })
    return updated
  }, [])

  const deleteAssistant = useCallback(
    async (
      id: string,
      options: { deleteTopics?: boolean; permanent?: boolean } = {}
    ): Promise<DeleteAssistantResult> => {
      const deleteTopics = options.deleteTopics === true
      const result = await ipcApi.request(
        options.permanent ? 'trash.assistant.delete_permanently' : 'trash.assistant.archive',
        { assistantId: id, deleteTopics }
      )
      await invalidate(deleteTopics ? [...ASSISTANTS_REFRESH_KEYS, '/pins', '/topics'] : ASSISTANTS_REFRESH_KEYS)
      logger.info('Deleted assistant', { id, deleteTopics: options.deleteTopics === true })
      return result
    },
    [invalidate]
  )

  const restoreAssistant = useCallback(async (id: string): Promise<Assistant> => {
    const restored = await restoreTriggerRef.current({ params: { id } })
    logger.info('Restored assistant', { id })
    return restored
  }, [])

  return {
    createAssistant,
    updateAssistant,
    deleteAssistant,
    restoreAssistant,
    isCreating,
    isUpdating,
    isDeleting: false
  }
}

// ─── Tier 2: composed hooks ───────────────────────────────────────────────

export function useAssistants() {
  const { assistants, hasLoaded, isLoading, isRefreshing, error, refetch } = useAssistantsApi()
  const { createAssistant, deleteAssistant, updateAssistant } = useAssistantMutations()

  return {
    assistants,
    hasLoaded,
    isLoading,
    isRefreshing,
    error,
    refetch,
    addAssistant: (dto: CreateAssistantDto) => createAssistant(dto),
    removeAssistant: (id: string) => deleteAssistant(id),
    updateAssistant: (id: string, patch: UpdateAssistantDto) => updateAssistant(id, patch)
  }
}

/**
 * Hook for a single persisted assistant. Returns `assistant: undefined` when
 * `id` is empty / null — callers should fall back to UI defaults (e.g.
 * `assistant?.name ?? t('chat.default.name')`) rather than receiving a
 * synthesised default Assistant. There is no special-case branch for the
 * "default assistant" — a topic with no assistant carries
 * `assistantId: undefined`, not a sentinel.
 *
 * Model contract:
 * - no assistant id: use the runtime default model preference;
 * - persisted assistant id: use only that assistant's `modelId`.
 *
 * Do not fall back from a persisted assistant with an empty `modelId` to the
 * runtime default model. The main send path rejects that state, so the
 * renderer must expose it as "select model" instead of masking it.
 *
 * Single-assistant identity switches opt out of DataApi's default
 * `keepPreviousData` behavior at the query boundary, so this hook only exposes
 * the source data for the current id.
 */
export function useAssistant(id: string | null | undefined, options: { loadDefaultModel?: boolean } = {}) {
  const { assistant, isLoading, error } = useAssistantApiById(id ?? undefined)
  const { updateAssistant: patchAssistant } = useAssistantMutations()
  const [defaultModelId] = usePreference('chat.default_model_id')
  const shouldLoadDefaultModel = options.loadDefaultModel ?? true
  const { providers } = useProviders()
  const idRef = useRef(id)
  const assistantRef = useRef(assistant)
  const patchAssistantRef = useRef(patchAssistant)
  const providersRef = useRef(providers)
  // Settings PATCHed here that the query cache has not reflected yet.
  // AssistantService shallow-merges `settings`, so a follow-up PATCH built from
  // a stale snapshot would overwrite keys an in-flight PATCH just wrote (e.g. a
  // reasoning-effort selection made moments before a model switch).
  const pendingSettingsRef = useRef<Partial<AssistantSettings>>({})
  // Last-writer sequence per top-level settings key. A failed PATCH must only
  // revert keys it still owns — a newer overlapping mutation may have already
  // overwritten the key with a fresher value that must survive.
  const pendingVersionsRef = useRef<Partial<Record<keyof AssistantSettings, number>>>({})
  const pendingSeqRef = useRef(0)
  idRef.current = id
  assistantRef.current = assistant
  patchAssistantRef.current = patchAssistant
  providersRef.current = providers

  // Fresh cache data supersedes anything staged optimistically.
  useEffect(() => {
    pendingSettingsRef.current = {}
    pendingVersionsRef.current = {}
  }, [assistant])

  const modelId =
    assistant?.modelId ?? (!id && shouldLoadDefaultModel ? (defaultModelId as UniqueModelId | null) : undefined)
  const { model, isLoading: isModelLoading } = useModelById(modelId)
  const isModelPending = (!!id && isLoading) || (!!modelId && isModelLoading)
  const isModelMissing = !isModelPending && !model

  const updateAssistantSettings = useCallback(
    (
      settings: Partial<AssistantSettings> | ((latest: AssistantSettings) => Partial<AssistantSettings>)
    ): Promise<Assistant | undefined> => {
      const currentId = idRef.current
      const currentAssistant = assistantRef.current
      if (!currentId || !currentAssistant) return Promise.resolve(undefined)
      const latestSettings = { ...currentAssistant.settings, ...pendingSettingsRef.current }
      const patch = typeof settings === 'function' ? settings(latestSettings) : settings
      const staged = stagePendingSettings(pendingSettingsRef, pendingVersionsRef, pendingSeqRef, patch)
      return patchAssistantRef.current(currentId, { settings: patch }).catch((error) => {
        revertPendingSettings(pendingSettingsRef, pendingVersionsRef, staged, patch)
        throw error
      })
    },
    []
  )

  const setModel = useCallback((next: Model, extraSettings?: Partial<AssistantSettings>) => {
    const currentId = idRef.current
    const currentAssistant = assistantRef.current
    if (!currentId || !currentAssistant) return
    const currentSettings = { ...currentAssistant.settings, ...pendingSettingsRef.current }
    // reconcile* are v2-native; next.id is the UniqueModelId.
    const reasoning = reconcileReasoningEffortForModel(
      next,
      currentSettings.reasoning_effort,
      currentId,
      currentSettings.reasoning_effort_by_model
    )
    const nextProvider = providersRef.current.find((provider) => provider.id === next.providerId)
    const webSearch = reconcileWebSearchForModel(next, currentSettings, nextProvider)
    // Delta-only patch: the service shallow-merges settings, so re-sending the
    // full snapshot could resurrect stale keys over concurrent in-flight writes.
    const settingsPatch =
      reasoning || webSearch || extraSettings ? { ...reasoning, ...webSearch, ...extraSettings } : undefined
    const update = patchAssistantRef.current(
      currentId,
      settingsPatch ? { modelId: next.id, settings: settingsPatch } : { modelId: next.id }
    )
    if (!settingsPatch) return update
    const staged = stagePendingSettings(pendingSettingsRef, pendingVersionsRef, pendingSeqRef, settingsPatch)
    return update.catch((error) => {
      revertPendingSettings(pendingSettingsRef, pendingVersionsRef, staged, settingsPatch)
      throw error
    })
  }, [])

  const updateAssistant = useCallback((patch: UpdateAssistantDto) => {
    const currentId = idRef.current
    if (!currentId) return Promise.resolve(undefined)
    return patchAssistantRef.current(currentId, patch)
  }, [])

  return {
    assistant,
    isLoading,
    error,
    model,
    isModelPending,
    isModelMissing,
    setModel,
    updateAssistant,
    updateAssistantSettings
  }
}
