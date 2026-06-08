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

const ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE = 50

function getUpdatedAtFromMs(updatedAtFrom: string | undefined): number | undefined {
  if (!updatedAtFrom) return undefined
  const value = Date.parse(updatedAtFrom)
  return Number.isFinite(value) ? value : undefined
}

export class EntitySearchService {
  async search(query: EntitySearchQuery): Promise<EntitySearchResponse> {
    const requestedTypes = new Set(query.types ?? entitySearchTypes)
    const types = entitySearchTypes.filter((type) => requestedTypes.has(type))
    const updatedAtFromMs = getUpdatedAtFromMs(query.updatedAtFrom)
    const limit = Math.min(query.limitPerType ?? ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE, ENTITY_SEARCH_MAX_LIMIT_PER_TYPE)

    const groups = await Promise.all(types.map((type) => this.searchType(type, query.q, limit, updatedAtFromMs)))

    return {
      query: query.q,
      groups
    }
  }

  private async searchType(
    type: EntitySearchType,
    q: string,
    limit: number,
    updatedAtFromMs: number | undefined
  ): Promise<EntitySearchGroup> {
    const input = { q, limit, updatedAtFrom: updatedAtFromMs }
    let items: EntitySearchItem[]

    switch (type) {
      case 'assistant':
        items = await assistantDataService.search(input)
        break
      case 'agent':
        items = await agentService.search(input)
        break
      case 'topic':
        items = await topicService.search(input)
        break
      case 'session':
        items = await agentSessionService.search({ search: q, limit, updatedAtFrom: updatedAtFromMs })
        break
      case 'knowledge-base':
        items = await knowledgeBaseService.search(input)
        break
    }

    return { type, items }
  }
}

export const entitySearchService = new EntitySearchService()
