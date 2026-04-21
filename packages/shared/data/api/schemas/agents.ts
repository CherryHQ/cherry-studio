/**
 * Agents domain API Schema definitions
 *
 * Covers agents, sessions, session messages, scheduled tasks, and skills.
 */

import type {
  AgentConfiguration,
  AgentDetail,
  AgentSessionDetail,
  AgentSessionEntity,
  AgentType,
  InstalledSkill,
  ListAgentSessionsResponse,
  ListAgentsResponse,
  ListSessionMessagesResponse,
  ListTasksResponse,
  ScheduledTaskEntity,
  SlashCommand,
  TaskScheduleType,
  TaskStatus
} from '@shared/data/types/agent'

// ============================================================================
// Agent DTOs
// ============================================================================

export interface CreateAgentDto {
  type: AgentType
  name: string
  model: string
  description?: string
  accessiblePaths?: string[]
  instructions?: string
  planModel?: string
  smallModel?: string
  mcps?: string[]
  allowedTools?: string[]
  slashCommands?: SlashCommand[]
  configuration?: AgentConfiguration
}

export interface UpdateAgentDto {
  name?: string
  description?: string
  accessiblePaths?: string[]
  instructions?: string
  model?: string
  planModel?: string
  smallModel?: string
  mcps?: string[]
  allowedTools?: string[]
  slashCommands?: SlashCommand[]
  configuration?: AgentConfiguration
}

// ============================================================================
// Session DTOs
// ============================================================================

export interface CreateSessionDto {
  model: string
  name?: string
  description?: string
  accessiblePaths?: string[]
  instructions?: string
  planModel?: string
  smallModel?: string
  mcps?: string[]
  allowedTools?: string[]
  slashCommands?: SlashCommand[]
  configuration?: AgentConfiguration
}

export interface UpdateSessionDto extends Partial<CreateSessionDto> {}

// ============================================================================
// Session message DTOs
// ============================================================================

export interface ListSessionMessagesParams {
  limit?: number
  offset?: number
}

// ============================================================================
// Task DTOs
// ============================================================================

export interface CreateTaskDto {
  name: string
  prompt: string
  scheduleType: TaskScheduleType
  scheduleValue: string
  timeoutMinutes?: number | null
  channelIds?: string[]
}

export interface UpdateTaskDto {
  name?: string
  prompt?: string
  scheduleType?: TaskScheduleType
  scheduleValue?: string
  timeoutMinutes?: number | null
  channelIds?: string[]
  status?: TaskStatus
}

// ============================================================================
// Common query types
// ============================================================================

export interface ListQuery {
  limit?: number
  offset?: number
}

// ============================================================================
// API Schema definitions
// ============================================================================

export interface AgentSchemas {
  /** List all agents, create a new agent */
  '/agents': {
    GET: {
      query: ListQuery
      response: ListAgentsResponse
    }
    POST: {
      body: CreateAgentDto
      response: AgentDetail
    }
  }

  /** Get, update, or delete a specific agent */
  '/agents/:agentId': {
    GET: {
      params: { agentId: string }
      response: AgentDetail
    }
    PATCH: {
      params: { agentId: string }
      body: UpdateAgentDto
      response: AgentDetail
    }
    DELETE: {
      params: { agentId: string }
      response: void
    }
  }

  /** List sessions for an agent, create a new session */
  '/agents/:agentId/sessions': {
    GET: {
      params: { agentId: string }
      query: ListQuery
      response: ListAgentSessionsResponse
    }
    POST: {
      params: { agentId: string }
      body: CreateSessionDto
      response: AgentSessionDetail
    }
  }

  /** Get, update, or delete a specific session */
  '/agents/:agentId/sessions/:sessionId': {
    GET: {
      params: { agentId: string; sessionId: string }
      response: AgentSessionDetail
    }
    PATCH: {
      params: { agentId: string; sessionId: string }
      body: UpdateSessionDto
      response: AgentSessionEntity
    }
    DELETE: {
      params: { agentId: string; sessionId: string }
      response: void
    }
  }

  /** List session messages */
  '/agents/:agentId/sessions/:sessionId/messages': {
    GET: {
      params: { agentId: string; sessionId: string }
      query: ListSessionMessagesParams
      response: ListSessionMessagesResponse
    }
  }

  /** Delete a specific session message */
  '/agents/:agentId/sessions/:sessionId/messages/:messageId': {
    DELETE: {
      params: { agentId: string; sessionId: string; messageId: string }
      response: void
    }
  }

  /** List tasks for an agent, create a new task */
  '/agents/:agentId/tasks': {
    GET: {
      params: { agentId: string }
      query: ListQuery
      response: ListTasksResponse
    }
    POST: {
      params: { agentId: string }
      body: CreateTaskDto
      response: ScheduledTaskEntity
    }
  }

  /** Get, update, or delete a specific task */
  '/agents/:agentId/tasks/:taskId': {
    GET: {
      params: { agentId: string; taskId: string }
      response: ScheduledTaskEntity
    }
    PATCH: {
      params: { agentId: string; taskId: string }
      body: UpdateTaskDto
      response: ScheduledTaskEntity
    }
    DELETE: {
      params: { agentId: string; taskId: string }
      response: void
    }
  }

  /** List all installed skills */
  '/skills': {
    GET: {
      response: { data: InstalledSkill[] }
    }
  }

  /** Get a specific skill by ID */
  '/skills/:id': {
    GET: {
      params: { id: string }
      response: InstalledSkill
    }
  }
}
