import { agentService } from '@data/services/AgentService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { sessionService } from '@data/services/SessionService'
import { topicService } from '@data/services/TopicService'
import type {
  GlobalSearchGroup,
  GlobalSearchItem,
  GlobalSearchQuery,
  GlobalSearchResponse,
  GlobalSearchType
} from '@shared/data/api/schemas/globalSearch'

const GLOBAL_SEARCH_TYPES: GlobalSearchType[] = ['assistant', 'agent', 'topic', 'session', 'knowledge-base']

export class GlobalSearchService {
  async search(query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    const requestedTypes = new Set(query.types ?? GLOBAL_SEARCH_TYPES)
    const types = GLOBAL_SEARCH_TYPES.filter((type) => requestedTypes.has(type))

    const groups = await Promise.all(
      types.map(
        async (type): Promise<GlobalSearchGroup> => ({
          type,
          items: await this.searchType(type, query.q, query.limitPerType)
        })
      )
    )

    return {
      query: query.q,
      groups
    }
  }

  private async searchType(type: GlobalSearchType, q: string, limit: number): Promise<GlobalSearchItem[]> {
    switch (type) {
      case 'assistant':
        return await this.searchAssistants(q, limit)
      case 'agent':
        return await this.searchAgents(q, limit)
      case 'topic':
        return await this.searchTopics(q, limit)
      case 'session':
        return await this.searchSessions(q, limit)
      case 'knowledge-base':
        return await this.searchKnowledgeBases(q, limit)
    }
  }

  private async searchAssistants(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await assistantDataService.list({ search: q, page: 1, limit })
    return result.items.map((item) => ({
      type: 'assistant',
      id: item.id,
      title: item.name,
      subtitle: item.description || undefined,
      emoji: item.emoji,
      updatedAt: item.updatedAt,
      target: { assistantId: item.id }
    }))
  }

  private async searchAgents(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await agentService.listAgents({ search: q, limit, offset: 0 })
    return result.agents.map((item) => ({
      type: 'agent',
      id: item.id,
      title: item.name,
      subtitle: item.description || undefined,
      emoji: item.configuration?.avatar || undefined,
      updatedAt: item.updatedAt,
      target: { agentId: item.id }
    }))
  }

  private async searchTopics(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await topicService.listByCursor({ q, limit })
    const assistantNames = await this.getAssistantNameMap(result.items.map((item) => item.assistantId))
    return result.items.map((item) => ({
      type: 'topic',
      id: item.id,
      title: item.name,
      subtitle: item.assistantId ? assistantNames.get(item.assistantId) : undefined,
      updatedAt: item.updatedAt,
      target: { topicId: item.id, assistantId: item.assistantId }
    }))
  }

  private async searchSessions(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await sessionService.listByCursor({ search: q, limit })
    const agentNames = await this.getAgentNameMap(result.items.map((item) => item.agentId))
    return result.items.map((item) => ({
      type: 'session',
      id: item.id,
      title: item.name,
      subtitle: item.agentId ? agentNames.get(item.agentId) : undefined,
      updatedAt: item.updatedAt,
      target: { sessionId: item.id, agentId: item.agentId }
    }))
  }

  private async searchKnowledgeBases(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await knowledgeBaseService.list({ search: q, page: 1, limit })
    return result.items.map((item) => ({
      type: 'knowledge-base',
      id: item.id,
      title: item.name,
      emoji: item.emoji,
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
