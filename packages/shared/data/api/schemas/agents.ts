/**
 * Agents domain API Schema definitions
 *
 * Covers agents, sessions, session messages, scheduled tasks, and skills.
 */

import type {
  AgentBase,
  AgentConfiguration,
  AgentDetail,
  AgentSessionDetail,
  AgentSessionEntity,
  AgentType,
  InstalledSkill,
  ListAgentSessionsResponse,
  ListAgentsResponse,
  ListSessionMessagesResponse,
  ListSkillsResponse,
  ListTasksResponse,
  ScheduledTaskEntity,
  SlashCommand,
  TaskScheduleType,
  TaskStatus
} from '@shared/data/types/agent'

// ============================================================================
// Agent DTOs
// ============================================================================

export interface CreateAgentDto extends AgentBase {
  type: AgentType
  /** Agent name (required) */
  name: string
  /** Main model ID (required) */
  model: string
}

export interface UpdateAgentDto extends Partial<AgentBase> {}

// ============================================================================
// Session DTOs
// ============================================================================

export interface CreateSessionDto {
  /** Main model ID (required) */
  model: string
  name?: string
  description?: string
  accessible_paths?: string[]
  instructions?: string
  plan_model?: string
  small_model?: string
  mcps?: string[]
  allowed_tools?: string[]
  slash_commands?: SlashCommand[]
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
  /** Display name for the task */
  name: string
  /** Prompt sent to the agent on each run */
  prompt: string
  schedule_type: TaskScheduleType
  /** Cron expression, interval in minutes, or delay in seconds depending on schedule_type */
  schedule_value: string
  timeout_minutes?: number | null
  /** Channel IDs to notify on completion */
  channel_ids?: string[]
}

export interface UpdateTaskDto {
  name?: string
  prompt?: string
  schedule_type?: TaskScheduleType
  schedule_value?: string
  timeout_minutes?: number | null
  channel_ids?: string[]
  status?: TaskStatus
}

// ============================================================================
// API Schema definitions
// ============================================================================

export interface AgentSchemas {
  /** List all agents, create a new agent */
  '/agents': {
    GET: {
      response: ListAgentsResponse
    }
    POST: {
      body: CreateAgentDto
      response: AgentDetail
    }
  }

  /** Get, update, or delete a specific agent */
  '/agents/:id': {
    GET: {
      params: { id: string }
      response: AgentDetail
    }
    PATCH: {
      params: { id: string }
      body: UpdateAgentDto
      response: AgentDetail
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /** List sessions for an agent, create a new session */
  '/agents/:id/sessions': {
    GET: {
      params: { id: string }
      response: ListAgentSessionsResponse
    }
    POST: {
      params: { id: string }
      body: CreateSessionDto
      response: AgentSessionDetail
    }
  }

  /** Get, update, or delete a specific session */
  '/agents/:id/sessions/:sid': {
    GET: {
      params: { id: string; sid: string }
      response: AgentSessionDetail
    }
    PATCH: {
      params: { id: string; sid: string }
      body: UpdateSessionDto
      response: AgentSessionEntity
    }
    DELETE: {
      params: { id: string; sid: string }
      response: void
    }
  }

  /** List or delete session messages */
  '/agents/:id/sessions/:sid/messages': {
    GET: {
      params: { id: string; sid: string }
      query: ListSessionMessagesParams
      response: ListSessionMessagesResponse
    }
    DELETE: {
      params: { id: string; sid: string; messageId: number }
      response: void
    }
  }

  /** List tasks for an agent, create a new task */
  '/agents/:id/tasks': {
    GET: {
      params: { id: string }
      response: ListTasksResponse
    }
    POST: {
      params: { id: string }
      body: CreateTaskDto
      response: ScheduledTaskEntity
    }
  }

  /** Get, update, or delete a specific task */
  '/agents/:id/tasks/:tid': {
    GET: {
      params: { id: string; tid: string }
      response: ScheduledTaskEntity
    }
    PATCH: {
      params: { id: string; tid: string }
      body: UpdateTaskDto
      response: ScheduledTaskEntity
    }
    DELETE: {
      params: { id: string; tid: string }
      response: void
    }
  }

  /** List all installed skills */
  '/skills': {
    GET: {
      response: ListSkillsResponse
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
