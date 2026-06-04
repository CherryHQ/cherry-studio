/**
 * Assistant data layer — three tiers in one module:
 *
 *  1. Runtime/default-assistant composition lives in
 *     `@renderer/domain/assistant/runtimeDefaultAssistant`.
 *  2. DataApi tier — raw SQLite-backed queries/mutations
 *     (`useAssistantsApi` / `useAssistantApiById` / `useAssistantMutations`).
 *  3. Composed hooks — `useAssistants` / `useDefaultAssistant` / `useAssistant`.
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
import {
  composeDefaultAssistant,
  composeRuntimeDefaultAssistant,
  isRuntimeDefaultAssistantId,
  type RuntimeDefaultAssistant
} from '@renderer/domain/assistant/runtimeDefaultAssistant'
import { useModelById } from '@renderer/hooks/useModel'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Model } from '@shared/data/types/model'
import { type UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useAssistant')

type UseAssistantResultBase<TAssistant> = {
  assistant: TAssistant
  isLoading: boolean
  error: unknown
  model: Model | undefined
  isModelPending: boolean
  isModelMissing: boolean
  setModel: (next: Model, extraSettings?: Partial<AssistantSettings>) => Promise<unknown> | void
}

type PersistedAssistantResult = UseAssistantResultBase<Assistant | undefined> & {
  kind: 'persisted'
  updateAssistant: (patch: UpdateAssistantDto) => Promise<Assistant | undefined>
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

type RuntimeDefaultAssistantResult = UseAssistantResultBase<RuntimeDefaultAssistant> & {
  kind: 'default'
}

type UseAssistantResult = PersistedAssistantResult | RuntimeDefaultAssistantResult

// ─── Tier 2: raw DataApi queries/mutations ────────────────────────────────

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
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants', {
    enabled: options.enabled ?? true,
    query: { limit: ASSISTANTS_LIST_LIMIT }
  })

  return {
    assistants: data?.items ?? EMPTY_ASSISTANTS,
    total: data?.total ?? 0,
    isLoading,
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

// ─── Tier 3: composed hooks ───────────────────────────────────────────────

export function useAssistants() {
  const { assistants, isLoading, error, refetch } = useAssistantsApi()
  const { createAssistant, deleteAssistant, updateAssistant } = useAssistantMutations()

  return {
    assistants,
    isLoading,
    error,
    refetch,
    addAssistant: (dto: CreateAssistantDto) => createAssistant(dto),
    removeAssistant: (id: string) => deleteAssistant(id),
    updateAssistant: (id: string, patch: UpdateAssistantDto) => updateAssistant(id, patch)
  }
}

/**
 * Returns the runtime default assistant display object. Use this only at UI
 * sites that need to render the "Default" option. Chat call sites should pass
 * `null` to `useAssistant()` and keep the runtime assistant id as `null`.
 */
export function useDefaultAssistant(): { assistant: RuntimeDefaultAssistant } {
  const [defaultModelId] = usePreference('chat.default_model_id')
  const modelId = (defaultModelId ?? null) as UniqueModelId | null
  const assistant = useMemo(() => composeDefaultAssistant(modelId), [modelId])
  return { assistant }
}

/**
 * Hook for one chat assistant identity. Null means the runtime default assistant
 * and uses `chat.default_model_id`, without querying Assistant DB.
 *
 * Model contract:
 * - null assistant id: use the runtime default model preference;
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
export function useAssistant(id: string): PersistedAssistantResult
export function useAssistant(id: null): RuntimeDefaultAssistantResult
export function useAssistant(id: string | null | undefined): UseAssistantResult
export function useAssistant(id: string | null | undefined): UseAssistantResult {
  const isRuntimeDefaultAssistant = isRuntimeDefaultAssistantId(id)
  const { assistant, isLoading, error } = useAssistantApiById(isRuntimeDefaultAssistant ? undefined : (id ?? undefined))
  const { updateAssistant: patchAssistant } = useAssistantMutations()
  const [defaultModelId, setDefaultModelId] = usePreference('chat.default_model_id')
  const modelIdFromDefaultPreference = (defaultModelId ?? null) as UniqueModelId | null
  const runtimeDefaultAssistant = useMemo(
    () => (isRuntimeDefaultAssistant ? composeRuntimeDefaultAssistant(modelIdFromDefaultPreference) : undefined),
    [isRuntimeDefaultAssistant, modelIdFromDefaultPreference]
  )
  const resolvedAssistant = runtimeDefaultAssistant ?? assistant
  const idRef = useRef(id)
  const assistantRef = useRef(resolvedAssistant)
  const patchAssistantRef = useRef(patchAssistant)
  const setDefaultModelIdRef = useRef(setDefaultModelId)
  idRef.current = id
  assistantRef.current = resolvedAssistant
  patchAssistantRef.current = patchAssistant
  setDefaultModelIdRef.current = setDefaultModelId

  const modelId = resolvedAssistant?.modelId ?? undefined
  const { model, isLoading: isModelLoading } = useModelById(modelId)
  const isModelPending = (!!id && !isRuntimeDefaultAssistant && isLoading) || (!!modelId && isModelLoading)
  const isModelMissing = !isModelPending && !model

  const updateAssistantSettings = useCallback((settings: Partial<AssistantSettings>) => {
    const currentId = idRef.current
    const currentAssistant = assistantRef.current
    if (isRuntimeDefaultAssistantId(currentId) || !currentId || !currentAssistant) return
    void patchAssistantRef.current(currentId, { settings })
  }, [])

  const setModel = useCallback((next: Model, extraSettings?: Partial<AssistantSettings>) => {
    const currentId = idRef.current
    const currentAssistant = assistantRef.current
    if (isRuntimeDefaultAssistantId(currentId)) {
      return setDefaultModelIdRef.current(next.id)
    }
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
    if (isRuntimeDefaultAssistantId(currentId) || !currentId) return Promise.resolve(undefined)
    return patchAssistantRef.current(currentId, patch)
  }, [])

  if (isRuntimeDefaultAssistant) {
    return {
      kind: 'default',
      assistant: runtimeDefaultAssistant!,
      isLoading,
      error,
      model,
      isModelPending,
      isModelMissing,
      setModel
    }
  }

  return {
    kind: 'persisted',
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
