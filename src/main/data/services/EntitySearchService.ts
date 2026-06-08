import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { topicService } from '@data/services/TopicService'
import type {
  EntitySearchGroup,
  EntitySearchItem,
  EntitySearchQuery,
  EntitySearchResponse,
  EntitySearchType
} from '@shared/data/api/schemas/search'
import { ENTITY_SEARCH_MAX_LIMIT_PER_TYPE, entitySearchTypes } from '@shared/data/api/schemas/search'
import { and, inArray, isNull } from 'drizzle-orm'

const ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE = 50

type EntitySearchSourceAdapter = (
  q: string,
  limit: number,
  updatedAtFromMs: number | undefined
) => Promise<EntitySearchItem[]>

function getUpdatedAtFromMs(updatedAtFrom: string | undefined): number | undefined {
  if (!updatedAtFrom) return undefined
  const value = Date.parse(updatedAtFrom)
  return Number.isFinite(value) ? value : undefined
}

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object') return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

export class EntitySearchService {
  private readonly sourceAdapters = {
    assistant: (q, limit, updatedAtFromMs) => this.searchAssistants(q, limit, updatedAtFromMs),
    agent: (q, limit, updatedAtFromMs) => this.searchAgents(q, limit, updatedAtFromMs),
    topic: (q, limit, updatedAtFromMs) => this.searchTopics(q, limit, updatedAtFromMs),
    session: (q, limit, updatedAtFromMs) => this.searchSessions(q, limit, updatedAtFromMs),
    'knowledge-base': (q, limit, updatedAtFromMs) => this.searchKnowledgeBases(q, limit, updatedAtFromMs)
  } satisfies Record<EntitySearchType, EntitySearchSourceAdapter>

  private get db() {
    return application.get('DbService').getDb()
  }

  async search(query: EntitySearchQuery): Promise<EntitySearchResponse> {
    const requestedTypes = new Set(query.types ?? entitySearchTypes)
    const types = entitySearchTypes.filter((type) => requestedTypes.has(type))
    const updatedAtFromMs = getUpdatedAtFromMs(query.updatedAtFrom)
    const limit = Math.min(query.limitPerType ?? ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE, ENTITY_SEARCH_MAX_LIMIT_PER_TYPE)

    const groups = await Promise.all(
      types.map(
        async (type): Promise<EntitySearchGroup> => ({
          type,
          items: await this.sourceAdapters[type](query.q, limit, updatedAtFromMs)
        })
      )
    )

    return {
      query: query.q,
      groups
    }
  }

  private async searchAssistants(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchItem[]> {
    const { items } = await assistantDataService.list({
      search: q,
      page: 1,
      limit,
      updatedAtFrom: updatedAtFromMs,
      sortBy: 'updatedAt',
      orderBy: 'desc'
    })

    return items.map((item) => ({
      type: 'assistant',
      id: item.id,
      title: item.name,
      subtitle: item.description || undefined,
      emoji: item.emoji,
      updatedAt: item.updatedAt,
      target: { assistantId: item.id }
    }))
  }

  private async searchAgents(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchItem[]> {
    const { agents } = await agentService.listAgents({
      search: q,
      limit,
      offset: 0,
      updatedAtFrom: updatedAtFromMs,
      sortBy: 'updatedAt',
      orderBy: 'desc'
    })

    return agents.map((item) => ({
      type: 'agent',
      id: item.id,
      title: item.name,
      subtitle: item.description || undefined,
      emoji: getAgentAvatar(item.configuration),
      updatedAt: item.updatedAt,
      target: { agentId: item.id }
    }))
  }

  private async searchTopics(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchItem[]> {
    const items = await topicService.listRecentSearchMatches({ q, limit, updatedAtFrom: updatedAtFromMs })

    const assistantNames = await this.getAssistantNameMap(items.map((item) => item.assistantId))
    return items.map((item) => ({
      type: 'topic',
      id: item.id,
      title: item.name,
      subtitle: item.assistantId ? assistantNames.get(item.assistantId) : undefined,
      updatedAt: item.updatedAt,
      target: { topicId: item.id, assistantId: item.assistantId ?? undefined }
    }))
  }

  private async searchSessions(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchItem[]> {
    const items = await agentSessionService.listRecentSearchMatches({
      search: q,
      limit,
      updatedAtFrom: updatedAtFromMs
    })

    const agentNames = await this.getAgentNameMap(items.map((item) => item.agentId))
    return items.map((item) => ({
      type: 'session',
      id: item.id,
      title: item.name,
      subtitle: item.agentId ? agentNames.get(item.agentId) : undefined,
      updatedAt: item.updatedAt,
      target: { sessionId: item.id, agentId: item.agentId }
    }))
  }

  private async searchKnowledgeBases(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchItem[]> {
    const { items } = await knowledgeBaseService.list({
      search: q,
      page: 1,
      limit,
      updatedAtFrom: updatedAtFromMs,
      sortBy: 'updatedAt',
      orderBy: 'desc'
    })

    return items.map((item) => ({
      type: 'knowledge-base',
      id: item.id,
      title: item.name,
      updatedAt: item.updatedAt,
      target: { knowledgeBaseId: item.id }
    }))
  }

  private async getAssistantNameMap(ids: Array<string | undefined>): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
    if (uniqueIds.length === 0) return new Map()

    const rows = await this.db
      .select({ id: assistantTable.id, name: assistantTable.name })
      .from(assistantTable)
      .where(and(inArray(assistantTable.id, uniqueIds), isNull(assistantTable.deletedAt)))

    return new Map(rows.map((row) => [row.id, row.name]))
  }

  private async getAgentNameMap(ids: Array<string | null>): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
    if (uniqueIds.length === 0) return new Map()

    const rows = await this.db
      .select({ id: agentTable.id, name: agentTable.name })
      .from(agentTable)
      .where(and(inArray(agentTable.id, uniqueIds), isNull(agentTable.deletedAt)))

    return new Map(rows.map((row) => [row.id, row.name]))
  }
}

export const entitySearchService = new EntitySearchService()
