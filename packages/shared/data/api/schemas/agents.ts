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

export interface AgentConfigurationDto extends Record<string, unknown> {
  avatar?: string
  slash_commands?: string[]
  permission_mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  max_turns?: number
  env_vars?: Record<string, string>
  soul_enabled?: boolean
  bootstrap_completed?: boolean
  scheduler_enabled?: boolean
  scheduler_type?: 'cron' | 'interval' | 'one-time'
  scheduler_cron?: string
  scheduler_interval?: number
  scheduler_one_time_delay?: number
  scheduler_last_run?: string
  heartbeat_enabled?: boolean
  heartbeat_interval?: number
}

export interface AgentSummaryDto {
  id: string
  type: string
  name?: string
  description?: string
  accessible_paths: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  configuration?: AgentConfigurationDto
  sort_order?: number
  created_at: string
  updated_at: string
}

export interface AgentDetailDto extends AgentSummaryDto {
  tools?: AgentToolDto[]
}

export interface CreateAgentDto {
  type: string
  name?: string
  description?: string
  accessible_paths: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  configuration?: AgentConfigurationDto
}

export interface UpdateAgentDto {
  name?: string
  description?: string
  accessible_paths?: string[]
  instructions?: string
  model?: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  configuration?: AgentConfigurationDto
}

export interface ReorderAgentsDto {
  orderedIds: string[]
}

export interface AgentSessionSummaryDto {
  id: string
  agent_id: string
  agent_type: string
  name?: string
  description?: string
  accessible_paths: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommandDto[]
  configuration?: AgentConfigurationDto
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

export interface CreateAgentSessionDto {
  name?: string
  description?: string
  accessible_paths: string[]
  instructions?: string
  model: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommandDto[]
  configuration?: AgentConfigurationDto
}

export interface UpdateAgentSessionDto {
  name?: string
  description?: string
  accessible_paths?: string[]
  instructions?: string
  model?: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommandDto[]
  configuration?: AgentConfigurationDto
}

export interface ReorderAgentSessionsDto {
  orderedIds: string[]
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
    POST: {
      body: CreateAgentDto
      response: AgentDetailDto
    }
    PATCH: {
      body: ReorderAgentsDto
      response: { success: true }
    }
  }

  '/agents/:id': {
    GET: {
      params: { id: string }
      response: AgentDetailDto
    }
    PATCH: {
      params: { id: string }
      body: UpdateAgentDto
      response: AgentDetailDto
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/agents/:agentId/sessions': {
    GET: {
      params: { agentId: string }
      query?: AgentSessionListQueryDto
      response: OffsetPaginationResponse<AgentSessionSummaryDto>
    }
    POST: {
      params: { agentId: string }
      body: CreateAgentSessionDto
      response: AgentSessionDetailDto
    }
    PATCH: {
      params: { agentId: string }
      body: ReorderAgentSessionsDto
      response: { success: true }
    }
  }

  '/agents/:agentId/sessions/:id': {
    GET: {
      params: { agentId: string; id: string }
      response: AgentSessionDetailDto
    }
    PATCH: {
      params: { agentId: string; id: string }
      body: UpdateAgentSessionDto
      response: AgentSessionDetailDto
    }
    DELETE: {
      params: { agentId: string; id: string }
      response: void
    }
  }
}
