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
  AgentType,
  ScheduledTaskEntity,
  TaskRunLogEntity
} from '../api/schemas/agents'
export type { AgentSessionMessageEntity } from '../api/schemas/agentSessionMessages'
export type { InstalledSkill } from '../api/schemas/skills'
