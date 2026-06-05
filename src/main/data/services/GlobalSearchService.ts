import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import type {
  GlobalSearchGroup,
  GlobalSearchItem,
  GlobalSearchMessageItem,
  GlobalSearchQuery,
  GlobalSearchResponse,
  GlobalSearchType
} from '@shared/data/api/schemas/globalSearch'
import { GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE } from '@shared/data/api/schemas/globalSearch'
import { and, inArray, isNull } from 'drizzle-orm'

const GLOBAL_SEARCH_TYPES: GlobalSearchType[] = ['assistant', 'agent', 'topic', 'session', 'knowledge-base']
const GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE = 50
const GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT = 5

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

export class GlobalSearchService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async search(query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    const requestedTypes = new Set(query.types ?? GLOBAL_SEARCH_TYPES)
    const types = GLOBAL_SEARCH_TYPES.filter((type) => requestedTypes.has(type))
    const updatedAtFromMs = getUpdatedAtFromMs(query.updatedAtFrom)
    const limit = Math.min(query.limitPerType ?? GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE, GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE)

    const [groups, messageItems] = await Promise.all([
      Promise.all(
        types.map(
          async (type): Promise<GlobalSearchGroup> => ({
            type,
            items: await this.searchType(type, query.q, limit, updatedAtFromMs)
          })
        )
      ),
      query.includeMessages
        ? this.searchMessages(query.q, Math.min(limit, GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT), query.updatedAtFrom)
        : Promise.resolve([])
    ])

    return {
      query: query.q,
      groups,
      messageItems
    }
  }

  private async searchType(
    type: GlobalSearchType,
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<GlobalSearchItem[]> {
    switch (type) {
      case 'assistant':
        return await this.searchAssistants(q, limit, updatedAtFromMs)
      case 'agent':
        return await this.searchAgents(q, limit, updatedAtFromMs)
      case 'topic':
        return await this.searchTopics(q, limit, updatedAtFromMs)
      case 'session':
        return await this.searchSessions(q, limit, updatedAtFromMs)
      case 'knowledge-base':
        return await this.searchKnowledgeBases(q, limit, updatedAtFromMs)
    }
  }

  private async searchAssistants(
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<GlobalSearchItem[]> {
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
  ): Promise<GlobalSearchItem[]> {
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
  ): Promise<GlobalSearchItem[]> {
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
  ): Promise<GlobalSearchItem[]> {
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
  ): Promise<GlobalSearchItem[]> {
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

  private async searchMessages(
    q: string,
    limit: number,
    createdAtFrom: string | undefined
  ): Promise<GlobalSearchMessageItem[]> {
    const [topicMessages, sessionMessages] = await Promise.all([
      messageService.search({ q, limit, createdAtFrom }),
      agentSessionMessageService.search({ q, limit, createdAtFrom })
    ])

    return [
      ...topicMessages.items.map((item) => ({ ...item, sourceType: 'topic' as const })),
      ...sessionMessages.items.map((item) => ({ ...item, sourceType: 'session' as const }))
    ]
      .sort((a, b) => {
        const timeA = Date.parse(a.createdAt) || 0
        const timeB = Date.parse(b.createdAt) || 0
        if (timeA !== timeB) return timeB - timeA
        if (a.sourceType !== b.sourceType) return a.sourceType === 'topic' ? -1 : 1
        return b.messageId.localeCompare(a.messageId)
      })
      .slice(0, limit)
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

export const globalSearchService = new GlobalSearchService()
