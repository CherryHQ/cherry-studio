import type { OffsetPaginationResponse } from '../apiTypes'

export interface AgentToolDto {
  id: string
  name: string
  type: string
  description?: string
  requirePermissions?: boolean
}

export interface SlashCommandDto {
  command: string
  description?: string
}

export interface AgentPluginDto {
  filename: string
  type: 'agent' | 'command' | 'skill'
  metadata: Record<string, unknown>
}

export interface AgentSummaryDto {
  id: string
  type: string
  name: string
  description?: string
  accessible_paths?: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  configuration?: Record<string, unknown>
  sort_order?: number
  created_at: string
  updated_at: string
}

export interface AgentDetailDto extends AgentSummaryDto {
  tools?: AgentToolDto[]
}

export interface AgentSessionSummaryDto {
  id: string
  agent_id: string
  agent_type: string
  name: string
  description?: string
  accessible_paths?: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommandDto[]
  configuration?: Record<string, unknown>
  sort_order?: number
  created_at: string
  updated_at: string
}

export interface AgentSessionMessageDto {
  id: number
  session_id: string
  role: string
  content: unknown
  agent_session_id: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface AgentSessionDetailDto extends AgentSessionSummaryDto {
  tools?: AgentToolDto[]
  messages?: AgentSessionMessageDto[]
  plugins?: AgentPluginDto[]
}

export interface AgentListQueryDto {
  page?: number
  limit?: number
  sortBy?: 'created_at' | 'updated_at' | 'name' | 'sort_order'
  orderBy?: 'asc' | 'desc'
}

export interface AgentSessionListQueryDto {
  page?: number
  limit?: number
}

export interface AgentSchemas {
  '/agents': {
    GET: {
      query?: AgentListQueryDto
      response: OffsetPaginationResponse<AgentDetailDto>
    }
  }

  '/agents/:id': {
    GET: {
      params: { id: string }
      response: AgentDetailDto
    }
  }

  '/agents/:agentId/sessions': {
    GET: {
      params: { agentId: string }
      query?: AgentSessionListQueryDto
      response: OffsetPaginationResponse<AgentSessionSummaryDto>
    }
  }

  '/agents/:agentId/sessions/:id': {
    GET: {
      params: { agentId: string; id: string }
      response: AgentSessionDetailDto
    }
  }
}
