/**
 * DataApi-backed assistant queries and mutations.
 *
 * Phase 1 of the `useAssistant` migration: pure infra. None of the existing
 * `useAssistant` / `useAssistants` consumers call these yet — this file only
 * exposes the SWR-backed read path and the mutation triggers, so subsequent
 * phases can swap Redux reads for DataApi reads incrementally.
 *
 * Shape bridge: `mapApiAssistantToRendererAssistant` projects the canonical
 * `Assistant` (DB shape: thin, `modelId` / `mcpServerIds` / `knowledgeBaseIds`)
 * onto the renderer's rich `Assistant` (full `model` / `mcpServers` /
 * `knowledge_bases` objects). Phase 1 leaves the joined arrays empty —
 * Phase 2 will wire in runtime lookups (`useModel`, KB / MCP stores).
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type {
  Assistant as RendererAssistant,
  AssistantSettingCustomParameters as RendererCustomParameter,
  AssistantSettings as RendererAssistantSettings,
  ReasoningEffortOption
} from '@renderer/types'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant as ApiAssistant, AssistantSettings as ApiAssistantSettings } from '@shared/data/types/assistant'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useAssistantDataApi')

const ASSISTANTS_LIST_LIMIT = 500

const EMPTY_API_ASSISTANTS: readonly ApiAssistant[] = Object.freeze([])

const ASSISTANTS_REFRESH_KEYS: ConcreteApiPaths[] = ['/assistants', '/assistants/*']

/** Renderer accepts these reasoning effort values; everything else is dropped. */
const KNOWN_REASONING_EFFORTS: ReadonlySet<ReasoningEffortOption> = new Set<ReasoningEffortOption>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'auto',
  'default'
])

function adaptReasoningEffort(value: string): ReasoningEffortOption {
  return KNOWN_REASONING_EFFORTS.has(value as ReasoningEffortOption) ? (value as ReasoningEffortOption) : 'default'
}

/**
 * Convert DataApi `customParameters` to the renderer's looser shape.
 *
 * The two definitions match field-by-field except for the `'json'` variant —
 * DataApi types `value: unknown`, the renderer types `value: object`. We
 * narrow on `typeof === 'object' && !== null`; primitives sneaking in get
 * wrapped in `{ value }` so the renderer's contract holds.
 */
function adaptCustomParameters(params: ApiAssistantSettings['customParameters']): RendererCustomParameter[] {
  return params.map((p): RendererCustomParameter => {
    switch (p.type) {
      case 'string':
        return { name: p.name, type: 'string', value: p.value }
      case 'number':
        return { name: p.name, type: 'number', value: p.value }
      case 'boolean':
        return { name: p.name, type: 'boolean', value: p.value }
      case 'json': {
        const value = typeof p.value === 'object' && p.value !== null ? p.value : { value: p.value }
        return { name: p.name, type: 'json', value }
      }
    }
  })
}

function adaptSettings(api: ApiAssistantSettings): Partial<RendererAssistantSettings> {
  return {
    temperature: api.temperature,
    enableTemperature: api.enableTemperature,
    topP: api.topP,
    enableTopP: api.enableTopP,
    maxTokens: api.maxTokens,
    enableMaxTokens: api.enableMaxTokens,
    contextCount: api.contextCount,
    streamOutput: api.streamOutput,
    qwenThinkMode: api.qwenThinkMode,
    toolUseMode: api.toolUseMode,
    maxToolCalls: api.maxToolCalls,
    enableMaxToolCalls: api.enableMaxToolCalls,
    reasoning_effort: adaptReasoningEffort(api.reasoning_effort),
    customParameters: adaptCustomParameters(api.customParameters)
  }
}

/**
 * Project a DataApi `Assistant` onto the renderer's `Assistant` shape.
 *
 * What's hydrated here:
 *  - the scalar fields (id / name / prompt / emoji / description / settings)
 *  - settings-derived flags surfaced as top-level on the renderer type
 *    (`mcpMode`, `enableWebSearch`)
 *
 * What's intentionally LEFT for the consumer hook to fill (Phase 2):
 *  - `model` — DataApi stores `modelId` (UniqueModelId); the renderer wants
 *    the full `Model` object. Lookup happens via `useModel(modelId)` in the
 *    consumer.
 *  - `knowledge_bases` / `mcpServers` — DataApi stores ID lists, renderer
 *    wants joined objects.
 *  - `topics` — fetched separately via `useTopicsByAssistant(id)`.
 *
 * What's deprecated and dropped:
 *  - `defaultModel` (per-assistant override; deprecated, falls back to
 *    global default model).
 *  - `enableUrlContext` / `enableGenerateImage` / `webSearchProviderId` —
 *    moving to inputbar transient state (not assistant-owned).
 *  - `regularPhrases` — separate resource, not on assistant.
 *  - `messages` / `type` / `content` / `targetLanguage` — frontend-only or
 *    runtime-only fields.
 */
export function mapApiAssistantToRendererAssistant(api: ApiAssistant): RendererAssistant {
  return {
    id: api.id,
    name: api.name,
    prompt: api.prompt,
    emoji: api.emoji,
    description: api.description,
    type: 'assistant',
    topics: [],
    settings: adaptSettings(api.settings),
    mcpMode: api.settings.mcpMode,
    enableWebSearch: api.settings.enableWebSearch,
    // Phase 2 will hydrate these from runtime lookups.
    knowledge_bases: [],
    mcpServers: []
  }
}

/**
 * List all assistants from SQLite via DataApi.
 *
 * Returns up to {@link ASSISTANTS_LIST_LIMIT} assistants in a single fetch
 * (matches the schema's hard cap). For typical usage this is a single page;
 * paginated UI would need a different consumer.
 */
export function useAssistantsApi() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants', {
    query: { limit: ASSISTANTS_LIST_LIMIT }
  })

  const assistants = useMemo(() => (data?.items ?? []).map(mapApiAssistantToRendererAssistant), [data])

  return {
    /** Raw DataApi entities — useful when the consumer needs `modelId` directly. */
    apiAssistants: data?.items ?? EMPTY_API_ASSISTANTS,
    /** Renderer-shaped assistants (with empty `topics` / joined arrays for now). */
    assistants,
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

  const assistant = useMemo(() => (data ? mapApiAssistantToRendererAssistant(data) : undefined), [data])

  return {
    apiAssistant: data,
    assistant,
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
    async (dto: CreateAssistantDto): Promise<ApiAssistant> => {
      const created = await createTrigger({ body: dto })
      logger.info('Created assistant', { id: created.id })
      return created
    },
    [createTrigger]
  )

  const updateAssistant = useCallback(
    async (id: string, dto: UpdateAssistantDto): Promise<ApiAssistant> => {
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
