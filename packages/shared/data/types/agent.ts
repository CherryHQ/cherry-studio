/**
 * Agent domain entity types
 *
 * Types are derived from Zod entity schemas in `../api/schemas/agents`.
 * Import entity schemas from there; this file re-exports the inferred types for
 * backward-compatible consumption across main and renderer.
 */

import type {
  AgentDetail,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  InstalledSkill,
  ScheduledTaskEntity
} from '../api/schemas/agents'

export type {
  AgentBase,
  AgentConfiguration,
  AgentDetail,
  AgentEntity,
  AgentSessionDetail,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  InstalledSkill,
  ScheduledTaskEntity,
  SlashCommand
} from '../api/schemas/agents'

// ============================================================================
// Core agent types (plain aliases for non-Zod consumers)
// ============================================================================

export type AgentType = 'claude-code'

export type TaskScheduleType = 'cron' | 'interval' | 'once'

export type TaskStatus = 'active' | 'paused' | 'completed'

export type SessionMessageRole = 'user' | 'assistant' | 'tool' | 'system'

// ============================================================================
// List response types (deprecated – use OffsetPaginationResponse from @shared/data/api)
// ============================================================================

/** @deprecated Use `OffsetPaginationResponse<AgentDetail>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListAgentsResponse {
  data: AgentDetail[]
  total: number
  limit: number
  offset: number
}

/** @deprecated Use `OffsetPaginationResponse<AgentSessionEntity>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListAgentSessionsResponse {
  data: AgentSessionEntity[]
  total: number
  limit: number
  offset: number
}

/** @deprecated Use `OffsetPaginationResponse<ScheduledTaskEntity>` from `@shared/data/api`. Remove once #14431 rebinds renderer to DataApi. */
export interface ListTasksResponse {
  data: ScheduledTaskEntity[]
  total: number
  limit: number
  offset: number
}

export interface ListSkillsResponse {
  data: InstalledSkill[]
}

export interface ListSessionMessagesResponse {
  messages: AgentSessionMessageEntity[]
}
