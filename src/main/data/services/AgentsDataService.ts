import { agentService } from '@main/services/agents/services/AgentService'
import { sessionService } from '@main/services/agents/services/SessionService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  AgentDetailDto,
  AgentListQueryDto,
  AgentSessionDetailDto,
  AgentSessionListQueryDto,
  AgentSessionSummaryDto
} from '@shared/data/api/schemas/agents'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20

export class AgentsDataService {
  async listAgents(query: AgentListQueryDto = {}): Promise<OffsetPaginationResponse<AgentDetailDto>> {
    const page = Math.max(query.page ?? DEFAULT_PAGE, 1)
    const limit = Math.max(query.limit ?? DEFAULT_LIMIT, 1)
    const offset = (page - 1) * limit
    const sortBy = query.sortBy ?? 'sort_order'
    const orderBy = query.orderBy ?? (sortBy === 'sort_order' ? 'asc' : 'desc')

    const result = await agentService.listAgents({
      limit,
      offset,
      sortBy,
      orderBy
    })

    return {
      items: result.agents as AgentDetailDto[],
      total: result.total,
      page
    }
  }

  async getAgent(id: string): Promise<AgentDetailDto> {
    const agent = await agentService.getAgent(id)
    if (!agent) {
      throw DataApiErrorFactory.notFound('Agent', id)
    }
    return agent as AgentDetailDto
  }

  async listSessions(
    agentId: string,
    query: AgentSessionListQueryDto = {}
  ): Promise<OffsetPaginationResponse<AgentSessionSummaryDto>> {
    const page = Math.max(query.page ?? DEFAULT_PAGE, 1)
    const limit = Math.max(query.limit ?? DEFAULT_LIMIT, 1)
    const offset = (page - 1) * limit

    const result = await sessionService.listSessions(agentId, {
      limit,
      offset
    })

    return {
      items: result.sessions as AgentSessionSummaryDto[],
      total: result.total,
      page
    }
  }

  async getSession(agentId: string, sessionId: string): Promise<AgentSessionDetailDto> {
    const session = await sessionService.getSession(agentId, sessionId)
    if (!session) {
      throw DataApiErrorFactory.notFound('AgentSession', sessionId)
    }
    return session as AgentSessionDetailDto
  }
}

export const agentsDataService = new AgentsDataService()
