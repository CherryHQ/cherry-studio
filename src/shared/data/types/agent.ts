/**
 * Agent domain entity types
 *
 * Types are derived from Zod entity schemas in `../api/schemas/*`.
 * This file re-exports inferred types for backward-compatible consumption
 * across main and renderer.
 */

export type {
  AgentBase,
  AgentConfiguration,
  AgentEntity,
  CreateTaskDto as CreateTaskRequest,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  UpdateTaskDto as UpdateTaskRequest
} from '../api/schemas/agents'
export type { AgentSessionMessageEntity } from '../api/schemas/sessions'
export type { InstalledSkill } from '../api/schemas/skills'

// ============================================================================
// Core agent types (plain aliases for non-Zod consumers)
// ============================================================================

export type AgentType = 'claude-code'
