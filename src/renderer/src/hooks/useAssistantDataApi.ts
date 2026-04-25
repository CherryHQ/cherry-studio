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
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { useModels } from '@renderer/hooks/useModels'
import { useAllTopics, useTopicsByAssistant } from '@renderer/hooks/useTopicDataApi'
import type {
  Assistant as RendererAssistant,
  AssistantSettingCustomParameters as RendererCustomParameter,
  AssistantSettings as RendererAssistantSettings,
  KnowledgeBase,
  MCPServer,
  Model,
  ReasoningEffortOption,
  Topic as RendererTopic
} from '@renderer/types'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant as ApiAssistant, AssistantSettings as ApiAssistantSettings } from '@shared/data/types/assistant'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
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

// ============================================================================
// Phase 2: Join layer
//
// Hydrate the renderer's rich Assistant shape by joining DataApi data with
// stores that own the related entities (providers/models in Redux LLM,
// knowledge bases in Redux, MCP servers in DataApi, topics in DataApi).
// ============================================================================

const EMPTY_TOPICS: readonly RendererTopic[] = Object.freeze([])
const EMPTY_KNOWLEDGE_BASES: readonly KnowledgeBase[] = Object.freeze([])
const EMPTY_MCP_SERVERS: readonly MCPServer[] = Object.freeze([])

/** Look up a renderer `Model` by its DataApi `UniqueModelId` (`provider::model`). */
function findModelByUniqueId(allModels: readonly Model[], uniqueId: UniqueModelId | null): Model | undefined {
  if (!uniqueId) return undefined
  const { providerId, modelId } = parseUniqueModelId(uniqueId)
  return allModels.find((m) => m.id === modelId && m.provider === providerId)
}

/** Pick entities by id from a (typically small) list, preserving the id order. */
function pickById<T extends { id: string }>(allItems: readonly T[], ids: readonly string[]): T[] {
  if (ids.length === 0 || allItems.length === 0) return []
  const byId = new Map(allItems.map((item) => [item.id, item]))
  const result: T[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (item) result.push(item)
  }
  return result
}

interface JoinContext {
  allModels: readonly Model[]
  allKnowledgeBases: readonly KnowledgeBase[]
  allMcpServers: readonly MCPServer[]
  topics: readonly RendererTopic[]
}

/** Project a DataApi assistant + related stores into the renderer's rich shape. */
function joinAssistant(api: ApiAssistant, ctx: JoinContext): RendererAssistant {
  const base = mapApiAssistantToRendererAssistant(api)
  return {
    ...base,
    model: findModelByUniqueId(ctx.allModels, api.modelId),
    topics: ctx.topics.length === 0 ? [] : [...ctx.topics],
    knowledge_bases: pickById(ctx.allKnowledgeBases, api.knowledgeBaseIds),
    mcpServers: pickById(ctx.allMcpServers, api.mcpServerIds)
  }
}

/** All models from DataApi, adapted to the renderer's legacy `Model` shape. */
function useAllModels(): Model[] {
  const { models } = useModels()
  return useMemo(() => models.map(fromSharedModel), [models])
}

/**
 * Read a single assistant joined with model / topics / knowledge bases / MCP
 * servers. Phase 2 read path for the renderer's rich `Assistant` shape.
 */
export function useAssistantJoined(id: string | undefined) {
  const { apiAssistant, isLoading: isAssistantLoading, error, refetch, mutate } = useAssistantApiById(id)
  const { rendererTopics, isLoading: isTopicsLoading } = useTopicsByAssistant(id)
  const allModels = useAllModels()
  const { bases } = useKnowledgeBases()
  const { mcpServers } = useMCPServers()

  const assistant = useMemo(() => {
    if (!apiAssistant) return undefined
    return joinAssistant(apiAssistant, {
      allModels,
      allKnowledgeBases: bases ?? EMPTY_KNOWLEDGE_BASES,
      allMcpServers: mcpServers ?? EMPTY_MCP_SERVERS,
      topics: rendererTopics
    })
  }, [apiAssistant, allModels, bases, mcpServers, rendererTopics])

  return {
    apiAssistant,
    assistant,
    isLoading: isAssistantLoading || isTopicsLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Read all assistants joined with model / topics / knowledge bases / MCP
 * servers. Topics are bucketed from a single `/topics` fetch so the join
 * cost is O(assistants + topics) rather than N fetches.
 */
export function useAssistantsJoined() {
  const { apiAssistants, total, isLoading: isAssistantsLoading, error, refetch, mutate } = useAssistantsApi()
  const { rendererTopics, isLoading: isTopicsLoading } = useAllTopics()
  const allModels = useAllModels()
  const { bases } = useKnowledgeBases()
  const { mcpServers } = useMCPServers()

  const topicsByAssistant = useMemo(() => {
    const map = new Map<string, RendererTopic[]>()
    for (const topic of rendererTopics) {
      const list = map.get(topic.assistantId)
      if (list) list.push(topic)
      else map.set(topic.assistantId, [topic])
    }
    return map
  }, [rendererTopics])

  const assistants = useMemo(
    () =>
      apiAssistants.map((api) =>
        joinAssistant(api, {
          allModels,
          allKnowledgeBases: bases ?? EMPTY_KNOWLEDGE_BASES,
          allMcpServers: mcpServers ?? EMPTY_MCP_SERVERS,
          topics: topicsByAssistant.get(api.id) ?? EMPTY_TOPICS
        })
      ),
    [apiAssistants, allModels, bases, mcpServers, topicsByAssistant]
  )

  return {
    apiAssistants,
    assistants,
    total,
    isLoading: isAssistantsLoading || isTopicsLoading,
    error,
    refetch,
    mutate
  }
}
