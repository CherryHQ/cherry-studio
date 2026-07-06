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
export type { AgentSessionMessageEntity } from '../api/schemas/agentSessions'
export type { InstalledSkill } from '../api/schemas/skills'

// ============================================================================
// Core agent types (plain aliases for non-Zod consumers)
// ============================================================================

// Adding a third runtime? The per-type capability gates are hardcoded at each call site today
// (useAgentModelFilter, getPermissionModeCards, AgentEditDialog `isPi`, buildAgentCreateBody,
// getBuiltinSlashCommands, renderer isAgentType guard). With three runtimes that duplication
// tips over — introduce a shared runtime-capability descriptor ({ steering, mcp, skills,
// planMode, soul, modelTiers, … }) and fold those call sites into it instead of adding a
// third branch to each.
export type AgentType = 'claude-code' | 'pi'
