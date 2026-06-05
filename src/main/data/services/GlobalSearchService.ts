import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { topicService } from '@data/services/TopicService'
import type {
  GlobalSearchGroup,
  GlobalSearchItem,
  GlobalSearchQuery,
  GlobalSearchResponse,
  GlobalSearchType
} from '@shared/data/api/schemas/globalSearch'

const GLOBAL_SEARCH_TYPES: GlobalSearchType[] = ['assistant', 'agent', 'topic', 'session', 'knowledge-base']
const GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE = 50

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
  async search(query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    const requestedTypes = new Set(query.types ?? GLOBAL_SEARCH_TYPES)
    const types = GLOBAL_SEARCH_TYPES.filter((type) => requestedTypes.has(type))
    const updatedAtFromMs = getUpdatedAtFromMs(query.updatedAtFrom)
    const limit = query.limitPerType ?? GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE

    const groups = await Promise.all(
      types.map(
        async (type): Promise<GlobalSearchGroup> => ({
          type,
          items: await this.searchType(type, query.q, limit, updatedAtFromMs)
        })
      )
    )

    return {
      query: query.q,
      groups
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

  private async getAssistantNameMap(ids: Array<string | undefined>): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
    const pairs = await Promise.all(
      uniqueIds.map(async (id) => {
        const result = await assistantDataService.list({ id, page: 1, limit: 1 })
        const assistant = result.items[0]
        return assistant ? ([id, assistant.name] as const) : undefined
      })
    )

    return new Map(pairs.filter((pair): pair is readonly [string, string] => !!pair))
  }

  private async getAgentNameMap(ids: Array<string | null>): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
    const pairs = await Promise.all(
      uniqueIds.map(async (id) => {
        const agent = await agentService.getAgent(id)
        return agent ? ([id, agent.name] as const) : undefined
      })
    )

    return new Map(pairs.filter((pair): pair is readonly [string, string] => !!pair))
  }
}

export const globalSearchService = new GlobalSearchService()
