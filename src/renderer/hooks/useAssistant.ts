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

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useModelById } from '@renderer/hooks/useModel'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Model } from '@shared/data/types/model'
import { type UniqueModelId } from '@shared/data/types/model'
import { useCallback, useRef } from 'react'

const logger = loggerService.withContext('useAssistant')

// ─── Tier 1: raw DataApi queries/mutations ────────────────────────────────

const ASSISTANTS_LIST_LIMIT = 500

const EMPTY_ASSISTANTS: readonly Assistant[] = Object.freeze([])

const ASSISTANTS_REFRESH_KEYS: ConcreteApiPaths[] = ['/assistants', '/assistants/*']

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
 * Assistant mutations (create / update / delete) backed by DataApi.
 */
export function useAssistantMutations() {
  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/assistants', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/assistants/:id', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: deleteTrigger, isLoading: isDeleting } = useMutation('DELETE', '/assistants/:id', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const createTriggerRef = useRef(createTrigger)
  const updateTriggerRef = useRef(updateTrigger)
  const deleteTriggerRef = useRef(deleteTrigger)
  createTriggerRef.current = createTrigger
  updateTriggerRef.current = updateTrigger
  deleteTriggerRef.current = deleteTrigger

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

  const deleteAssistant = useCallback(async (id: string): Promise<void> => {
    await deleteTriggerRef.current({ params: { id } })
    logger.info('Deleted assistant', { id })
  }, [])

  return {
    createAssistant,
    updateAssistant,
    deleteAssistant,
    isCreating,
    isUpdating,
    isDeleting
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
  const idRef = useRef(id)
  const assistantRef = useRef(assistant)
  const patchAssistantRef = useRef(patchAssistant)
  idRef.current = id
  assistantRef.current = assistant
  patchAssistantRef.current = patchAssistant

  const modelId =
    assistant?.modelId ?? (!id && shouldLoadDefaultModel ? (defaultModelId as UniqueModelId | null) : undefined)
  const { model, isLoading: isModelLoading } = useModelById(modelId)
  const isModelPending = (!!id && isLoading) || (!!modelId && isModelLoading)
  const isModelMissing = !isModelPending && !model

  const updateAssistantSettings = useCallback((settings: Partial<AssistantSettings>) => {
    const currentId = idRef.current
    const currentAssistant = assistantRef.current
    if (!currentId || !currentAssistant) return
    void patchAssistantRef.current(currentId, { settings })
  }, [])

  const setModel = useCallback((next: Model, extraSettings?: Partial<AssistantSettings>) => {
    const currentId = idRef.current
    const currentAssistant = assistantRef.current
    if (!currentId || !currentAssistant) return
    // reconcile* are v2-native; next.id is the UniqueModelId.
    const reasoning = reconcileReasoningEffortForModel(next, currentAssistant.settings.reasoning_effort, currentId)
    const webSearch = reconcileWebSearchForModel(next, currentAssistant.settings)
    const settingsPatch =
      extraSettings || reasoning || webSearch
        ? { ...currentAssistant.settings, ...extraSettings, ...reasoning, ...webSearch }
        : undefined
    return patchAssistantRef.current(
      currentId,
      settingsPatch ? { modelId: next.id, settings: settingsPatch } : { modelId: next.id }
    )
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
