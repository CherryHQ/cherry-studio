/**
 * Agent entity types
 *
 * Agents are autonomous code agent configurations (model + tools + instructions).
 * Sessions are created from agents but run independently.
 */

import * as z from 'zod'

// ============================================================================
// Sub-Schemas
// ============================================================================

export const AgentTypeSchema = z.enum(['claude-code'])
export type AgentType = z.infer<typeof AgentTypeSchema>

// ============================================================================
// Agent Entity
// ============================================================================

export const AgentSchema = z.object({
  id: z.uuidv4(),
  type: AgentTypeSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  model: z.string().min(1),
  planModel: z.string().nullable().optional(),
  smallModel: z.string().nullable().optional(),
  accessiblePaths: z.array(z.string()).nullable().optional(),
  instructions: z.record(z.string(), z.unknown()).nullable().optional(),
  mcps: z.array(z.string()).nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  configuration: z.record(z.string(), z.unknown()).nullable().optional(),
  sortOrder: z.number().default(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Agent = z.infer<typeof AgentSchema>

// ============================================================================
// Agent Session Entity
// ============================================================================

export const AgentSessionSchema = z.object({
  id: z.uuidv4(),
  agentId: z.string().nullable().optional(),
  agentType: AgentTypeSchema,
  topicId: z.string(),
  model: z.string().min(1),
  planModel: z.string().nullable().optional(),
  smallModel: z.string().nullable().optional(),
  accessiblePaths: z.array(z.string()).nullable().optional(),
  instructions: z.record(z.string(), z.unknown()).nullable().optional(),
  mcps: z.array(z.string()).nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  slashCommands: z.array(z.unknown()).nullable().optional(),
  configuration: z.record(z.string(), z.unknown()).nullable().optional(),
  sdkSessionId: z.string().nullable().optional(),
  sortOrder: z.number().default(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type AgentSession = z.infer<typeof AgentSessionSchema>

// ============================================================================
// Snapshot Types (immutable records captured at message creation time)
// ============================================================================

/**
 * Agent session snapshot captured at message creation time.
 * Preserves the session configuration used to generate this message,
 * enabling audit, replay, and display even if the session is later modified or deleted.
 *
 * Only includes fields that affect message generation output.
 * Symmetric with AssistantSnapshot from PR #13851.
 */
export interface AgentSessionSnapshot {
  agentId: string | null
  agentType: string
  model: string
  planModel?: string | null
  smallModel?: string | null
  instructions?: Record<string, unknown> | null
  mcps?: string[] | null
  allowedTools?: string[] | null
  configuration?: Record<string, unknown> | null
}
