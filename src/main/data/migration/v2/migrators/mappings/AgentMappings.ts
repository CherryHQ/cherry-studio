/**
 * Agent migration mappings using Zod transform schemas
 *
 * Handles type conversions from legacy agents.db to v2 SQLite:
 * - JSON string columns → typed JSON objects
 * - snake_case → camelCase field renaming
 * - Legacy MessageBlock[] → v2 MessageData
 */

import type { MessageData, MessageDataBlock } from '@shared/data/types/message'
import * as z from 'zod'

// ============================================================================
// Reusable Transform Primitives
// ============================================================================

/**
 * Parse a JSON string column. If invalid JSON, returns null.
 * Legacy agents.db stores JSON as plain text without mode: 'json',
 * so values come back as raw strings that need parsing.
 */
const jsonString = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return null
    if (typeof val !== 'string') return val
    try {
      return JSON.parse(val)
    } catch {
      return null
    }
  }, inner.nullable())

// ============================================================================
// Legacy Input Schemas
// ============================================================================

/**
 * Legacy agents table row from agents.db.
 * Uses .passthrough() to not fail on unknown columns.
 */
export const LegacyAgentRowSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    model: z.string().min(1),
    plan_model: z.string().nullable().optional(),
    small_model: z.string().nullable().optional(),
    accessible_paths: jsonString(z.array(z.string())),
    instructions: jsonString(z.any()),
    mcps: jsonString(z.array(z.string())),
    allowed_tools: jsonString(z.array(z.string())),
    configuration: jsonString(z.record(z.string(), z.unknown())),
    sort_order: z.number().default(0),
    created_at: z.string(),
    updated_at: z.string()
  })
  .loose()

/**
 * Legacy sessions table row from agents.db.
 */
export const LegacySessionRowSchema = z
  .object({
    id: z.string().min(1),
    agent_id: z.string().min(1),
    agent_type: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    model: z.string().min(1),
    plan_model: z.string().nullable().optional(),
    small_model: z.string().nullable().optional(),
    accessible_paths: jsonString(z.array(z.string())),
    instructions: jsonString(z.any()),
    mcps: jsonString(z.array(z.string())),
    allowed_tools: jsonString(z.array(z.string())),
    slash_commands: jsonString(z.array(z.unknown())),
    configuration: jsonString(z.record(z.string(), z.unknown())),
    sort_order: z.number().default(0),
    created_at: z.string(),
    updated_at: z.string()
  })
  .loose()

/**
 * Structure inside legacy session_messages.content JSON blob.
 */
const LegacyPersistedMessageSchema = z.object({
  message: z
    .object({
      id: z.string(),
      role: z.string()
    })
    .loose(),
  blocks: z
    .array(
      z
        .object({
          type: z.string()
        })
        .loose()
    )
    .default([])
})

/**
 * Legacy session_messages table row from agents.db.
 */
export const LegacyMessageRowSchema = z
  .object({
    id: z.number(),
    session_id: z.string().min(1),
    role: z.string(),
    content: jsonString(LegacyPersistedMessageSchema),
    agent_session_id: z.string().default(''),
    metadata: jsonString(z.record(z.string(), z.unknown())),
    created_at: z.string(),
    updated_at: z.string()
  })
  .loose()

export type LegacyAgentRow = z.infer<typeof LegacyAgentRowSchema>
export type LegacySessionRow = z.infer<typeof LegacySessionRowSchema>
export type LegacyMessageRow = z.infer<typeof LegacyMessageRowSchema>

// ============================================================================
// Transform Schemas
// ============================================================================

/**
 * Agent transform: legacy row → new table insert values.
 *
 * Key conversions:
 * - snake_case → camelCase (plan_model → planModel)
 * - JSON strings → parsed objects (via jsonString preprocess)
 * - Preserves original ID for migration stability
 */
export const AgentTransformSchema = LegacyAgentRowSchema.transform((old) => ({
  id: old.id,
  type: old.type,
  name: old.name,
  description: old.description ?? null,
  model: old.model,
  planModel: old.plan_model ?? null,
  smallModel: old.small_model ?? null,
  accessiblePaths: old.accessible_paths ?? null,
  instructions: old.instructions ?? null,
  mcps: old.mcps ?? null,
  allowedTools: old.allowed_tools ?? null,
  configuration: old.configuration ?? null,
  sortOrder: old.sort_order
}))

/**
 * Session transform: legacy row → new table insert values.
 * Additional: agent_id → agentId, agent_type → agentType
 */
export const SessionTransformSchema = LegacySessionRowSchema.transform((old) => ({
  id: old.id,
  agentId: old.agent_id,
  agentType: old.agent_type,
  name: old.name,
  description: old.description ?? null,
  model: old.model,
  planModel: old.plan_model ?? null,
  smallModel: old.small_model ?? null,
  accessiblePaths: old.accessible_paths ?? null,
  instructions: old.instructions ?? null,
  mcps: old.mcps ?? null,
  allowedTools: old.allowed_tools ?? null,
  slashCommands: old.slash_commands ?? null,
  configuration: old.configuration ?? null,
  sortOrder: old.sort_order
}))

// ============================================================================
// Block Transform (pure function)
// ============================================================================

/**
 * Convert legacy MessageBlock[] to v2 MessageData.
 * Filters out invalid blocks (null, undefined, missing type).
 * Preserves all block-specific fields via spread.
 */
export function transformBlocksToMessageData(legacyBlocks: unknown[]): MessageData {
  const blocks = legacyBlocks
    .filter((b): b is Record<string, unknown> => b != null && typeof b === 'object' && 'type' in b && !!b.type)
    .map((b) => ({ ...b }) as unknown as MessageDataBlock)

  return { blocks }
}

// ============================================================================
// FK Validation Helpers (used in Migrator.prepare)
// ============================================================================

/**
 * Create a session transform that validates agentId FK exists.
 */
export const makeSessionTransformWithFkCheck = (validAgentIds: Set<string>) =>
  SessionTransformSchema.refine((session) => validAgentIds.has(session.agentId), {
    message: 'Referenced agent not found',
    path: ['agentId']
  })

/**
 * Create a message row parser that validates sessionId FK exists.
 */
export const makeMessageRowWithFkCheck = (validSessionIds: Set<string>) =>
  LegacyMessageRowSchema.refine((msg) => validSessionIds.has(msg.session_id), {
    message: 'Referenced session not found',
    path: ['session_id']
  })
