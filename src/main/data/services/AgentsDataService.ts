import { agentService } from '@main/services/agents/services/AgentService'
import { sessionService } from '@main/services/agents/services/SessionService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  AgentDetailDto,
  AgentListQueryDto,
  AgentSessionDetailDto,
  AgentSessionListQueryDto,
  AgentSessionSummaryDto,
  CreateAgentDto,
  CreateAgentSessionDto,
  UpdateAgentDto,
  UpdateAgentSessionDto
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

  async createAgent(body: CreateAgentDto): Promise<AgentDetailDto> {
    const agent = await agentService.createAgent(body as any)

    try {
      await sessionService.createSession(agent.id, {})
    } catch (error) {
      await agentService.deleteAgent(agent.id)
      throw DataApiErrorFactory.database(error as Error, 'create default agent session')
    }

    return await this.getAgent(agent.id)
  }

  async getAgent(id: string): Promise<AgentDetailDto> {
    const agent = await agentService.getAgent(id)
    if (!agent) {
      throw DataApiErrorFactory.notFound('Agent', id)
    }
    return agent as AgentDetailDto
  }

  async updateAgent(id: string, body: UpdateAgentDto): Promise<AgentDetailDto> {
    const updated = await agentService.updateAgent(id, body as any)
    if (!updated) {
      throw DataApiErrorFactory.notFound('Agent', id)
    }
    return updated as AgentDetailDto
  }

  async deleteAgent(id: string): Promise<void> {
    const deleted = await agentService.deleteAgent(id)
    if (!deleted) {
      throw DataApiErrorFactory.notFound('Agent', id)
    }
  }

  async reorderAgents(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) {
      throw DataApiErrorFactory.validation({ orderedIds: ['orderedIds must not be empty'] })
    }
    await agentService.reorderAgents(orderedIds)
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

  async createSession(agentId: string, body: CreateAgentSessionDto): Promise<AgentSessionDetailDto> {
    const session = await sessionService.createSession(agentId, body as any)
    if (!session) {
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }
    return session as AgentSessionDetailDto
  }

  async getSession(agentId: string, sessionId: string): Promise<AgentSessionDetailDto> {
    const session = await sessionService.getSession(agentId, sessionId)
    if (!session) {
      throw DataApiErrorFactory.notFound('AgentSession', sessionId)
    }
    return session as AgentSessionDetailDto
  }

  async updateSession(agentId: string, sessionId: string, body: UpdateAgentSessionDto): Promise<AgentSessionDetailDto> {
    const session = await sessionService.updateSession(agentId, sessionId, body as any)
    if (!session) {
      throw DataApiErrorFactory.notFound('AgentSession', sessionId)
    }
    return session as AgentSessionDetailDto
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const deleted = await sessionService.deleteSession(agentId, sessionId)
    if (!deleted) {
      throw DataApiErrorFactory.notFound('AgentSession', sessionId)
    }
  }

  async reorderSessions(agentId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) {
      throw DataApiErrorFactory.validation({ orderedIds: ['orderedIds must not be empty'] })
    }
    await sessionService.reorderSessions(agentId, orderedIds)
  }
}

export const agentsDataService = new AgentsDataService()
