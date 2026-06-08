import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { DataApiErrorFactory, isDataApiError, toDataApiError } from '@shared/data/api'
import type {
  EntitySearchGroup,
  EntitySearchQuery,
  EntitySearchResponse,
  EntitySearchType
} from '@shared/data/api/schemas/search'
import { ENTITY_SEARCH_MAX_LIMIT_PER_TYPE, entitySearchTypes } from '@shared/data/api/schemas/search'

const logger = loggerService.withContext('EntitySearchService')
const ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE = 50

type EntitySearchInput = { q: string; limit: number; updatedAtFrom?: number }

function getUpdatedAtFromMs(updatedAtFrom: string | undefined): number | undefined {
  if (!updatedAtFrom) return undefined
  const value = Date.parse(updatedAtFrom)
  return Number.isFinite(value) ? value : undefined
}

function withTypeContext(type: EntitySearchType, error: unknown) {
  const context = `entity search type ${type}`
  const apiError = toDataApiError(error, context)
  if (!isDataApiError(error)) return apiError

  return DataApiErrorFactory.create(
    apiError.code,
    `${context} failed: ${apiError.message}`,
    apiError.details,
    apiError.requestContext
  )
}

export class EntitySearchService {
  async search(query: EntitySearchQuery): Promise<EntitySearchResponse> {
    const requestedTypes = new Set(query.types ?? entitySearchTypes)
    const types = entitySearchTypes.filter((type) => requestedTypes.has(type))
    const updatedAtFromMs = getUpdatedAtFromMs(query.updatedAtFrom)
    const limit = Math.min(query.limitPerType ?? ENTITY_SEARCH_DEFAULT_LIMIT_PER_TYPE, ENTITY_SEARCH_MAX_LIMIT_PER_TYPE)

    // Federated entity search is all-or-nothing: one failed type makes the query fail
    // with type context instead of returning a silent partial read model.
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

    try {
      return await this.searchTypeUnchecked(type, input)
    } catch (error) {
      logger.error('entity search type failed', { type, error })
      throw withTypeContext(type, error)
    }
  }

  private async searchTypeUnchecked(type: EntitySearchType, input: EntitySearchInput): Promise<EntitySearchGroup> {
    switch (type) {
      case 'assistant':
        return { type, items: await assistantDataService.search(input) }
      case 'agent':
        return { type, items: await agentService.search(input) }
      case 'topic':
        return { type, items: await topicService.search(input) }
      case 'session':
        return { type, items: await agentSessionService.search(input) }
      case 'knowledge-base':
        return { type, items: await knowledgeBaseService.search(input) }
      default: {
        const exhaustive: never = type
        throw new Error(`Unknown entity search type: ${exhaustive}`)
      }
    }
  }
}

export const entitySearchService = new EntitySearchService()
