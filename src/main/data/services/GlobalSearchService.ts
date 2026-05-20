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
      updatedAt: item.updatedAt,
      target: { agentId: item.id }
    }))
  }

  private async searchTopics(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await topicService.listByCursor({ q, limit })
    return result.items.map((item) => ({
      type: 'topic',
      id: item.id,
      title: item.name,
      updatedAt: item.updatedAt,
      target: { topicId: item.id, assistantId: item.assistantId }
    }))
  }

  private async searchSessions(q: string, limit: number): Promise<GlobalSearchItem[]> {
    const result = await sessionService.listByCursor({ search: q, limit })
    return result.items.map((item) => ({
      type: 'session',
      id: item.id,
      title: item.name,
      subtitle: item.description || undefined,
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
      updatedAt: item.updatedAt,
      target: { knowledgeBaseId: item.id }
    }))
  }
}

export const globalSearchService = new GlobalSearchService()
