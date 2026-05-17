/**
 * Assistant data layer — three tiers in one module:
 *
 *  1. `composeDefaultAssistant` — pure, non-React synthesis of the default
 *     assistant template (also imported by `services/AssistantService`).
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
 *  - {@link import('./useMCPServers').useMCPServer} for MCP servers
 *  - {@link import('./useKnowledgeBaseDataApi').useKnowledgeBaseById} for KBs
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModel'
import i18n from '@renderer/i18n'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import { type UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useAssistant')

// ─── Tier 1: pure default-assistant composition ───────────────────────────

const DEFAULT_ASSISTANT_TIMESTAMP = new Date(0).toISOString()

/**
 * Pure runtime composition of the default assistant. v2 has no `id='default'`
 * row in SQLite (legacy `'default'` was remapped to a UUID by AssistantMigrator);
 * the default assistant is always synthesized from a static template plus the
 * caller-supplied `modelId` (sourced from `chat.default_model_id` preference).
 *
 * React contexts: prefer `useDefaultAssistant()` below.
 */
export function composeDefaultAssistant(modelId: UniqueModelId | null): Assistant {
  return {
    id: DEFAULT_ASSISTANT_ID,
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    description: '',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    modelId,
    modelName: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: DEFAULT_ASSISTANT_TIMESTAMP,
    updatedAt: DEFAULT_ASSISTANT_TIMESTAMP
  }
}

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
export function useAssistantsApi() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants', {
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
    enabled: !!id
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

  const createAssistant = useCallback(
    async (dto: CreateAssistantDto): Promise<Assistant> => {
      const created = await createTrigger({ body: dto })
      logger.info('Created assistant', { id: created.id })
      return created
    },
    [createTrigger]
  )

  const updateAssistant = useCallback(
    async (id: string, dto: UpdateAssistantDto): Promise<Assistant> => {
      if (!id) {
        throw new Error('updateAssistant called with empty id; refusing to issue PATCH /assistants/')
      }
      const updated = await updateTrigger({ params: { id }, body: dto })
      logger.info('Updated assistant', { id })
      return updated
    },
    [updateTrigger]
  )

  const deleteAssistant = useCallback(
    async (id: string): Promise<void> => {
      await deleteTrigger({ params: { id } })
      logger.info('Deleted assistant', { id })
    },
    [deleteTrigger]
  )

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
 * Returns the runtime-composed default-assistant template. Use this only at
 * UI sites that need to render the "Default" preset card or seed a new
 * assistant from the template (e.g. settings pages). It is
 * NOT meant for chat call sites — a topic without an assistant should be
 * rendered by handling `useAssistant(...).assistant === undefined` directly,
 * not by faking up an Assistant.
 */
export function useDefaultAssistant(): { assistant: Assistant } {
  const [defaultModelId] = usePreference('chat.default_model_id')
  const modelId = (defaultModelId ?? null) as UniqueModelId | null
  const assistant = useMemo(() => composeDefaultAssistant(modelId), [modelId])
  return { assistant }
}

/**
 * Hook for a single persisted assistant. Returns `assistant: undefined` when
 * `id` is empty / null — callers should fall back to UI defaults (e.g.
 * `assistant?.name ?? t('chat.default.name')`) rather than receiving a
 * synthesised default Assistant. There is no special-case branch for the
 * "default assistant" — a topic with no assistant carries
 * `assistantId: undefined`, not a sentinel.
 */
export function useAssistant(id: string | null | undefined) {
  const { assistant } = useAssistantApiById(id ?? undefined)
  const { updateAssistant: patchAssistant } = useAssistantMutations()
  const { defaultModel } = useDefaultModel()

  const modelId = (assistant?.modelId ?? defaultModel?.id) as UniqueModelId
  const { model } = useModelById(modelId)

  const updateAssistantSettings = useCallback(
    (settings: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
      void patchAssistant(id, { settings })
    },
    [assistant, id, patchAssistant]
  )

  return {
    assistant,
    model,
    setModel: (next: Model, extraSettings?: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
      // reconcile* are v2-native; next.id is the UniqueModelId.
      const reasoning = reconcileReasoningEffortForModel(next, assistant.settings.reasoning_effort, id)
      const webSearch = reconcileWebSearchForModel(next, assistant.settings)
      const settingsPatch =
        extraSettings || reasoning || webSearch
          ? { ...assistant.settings, ...extraSettings, ...reasoning, ...webSearch }
          : undefined
      void patchAssistant(id, settingsPatch ? { modelId: next.id, settings: settingsPatch } : { modelId: next.id })
    },
    updateAssistant: (patch: UpdateAssistantDto) => {
      if (!id) return Promise.resolve(undefined)
      return patchAssistant(id, patch)
    },
    updateAssistantSettings
  }
}
