/**
 * Assistant entity types
 *
 * Assistants represent model + manually assembled context configurations.
 * They store inference parameters, tool references, and context source toggles.
 */

import * as z from 'zod'

import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

import { ContextSettingsOverrideSchema } from './contextSettings'
import { GroupIdSchema } from './group'
import { ReasoningSummarySchema, ServiceTierSelectionSchema, UniqueModelIdSchema } from './model'

// ============================================================================
// Sub-Schemas
// ============================================================================

/** MCP server interaction mode */
export const McpModeSchema = z.enum(['disabled', 'auto', 'manual'])
export type McpMode = z.infer<typeof McpModeSchema>

/**
 * Effective mcpMode when `settings.mcpMode` is unset. Single source of truth —
 * main's resolver, the renderer helper, and the composer MCP selector must all
 * agree, or the same assistant resolves different tool sets per layer
 * (runtime-test finding #6). 'manual' = only explicitly linked servers.
 */
export const DEFAULT_MCP_MODE: McpMode = 'manual'

/** Accepted range for `settings.maxToolCalls`. The editor's spinner bounds and main's
 *  `resolveToolCallLimit` validation must agree, or a value the UI accepts silently
 *  falls back to the default at request time. */
export const MIN_TOOL_CALLS = 1
export const MAX_TOOL_CALLS = 1000

/**
 * Assistant settings — inference parameters + context source toggles.
 * Stored as a single JSON column in the database.
 *
 * Default values are centralized in `DEFAULT_ASSISTANT_SETTINGS`.
 *
 * `enable*` flags control whether the corresponding parameter is sent to the model.
 * When `enable* = false`, the value is still stored but not used — the model's own
 * default takes effect. This removes the need for nullable value fields.
 */
export const AssistantSettingsSchema = z.object({
  // -- Inference parameters --
  /** from DEFAULT_TEMPERATURE */
  temperature: z.number().min(0).max(2),
  /** disabled = use model's own default */
  enableTemperature: z.boolean(),
  topP: z.number().min(0).max(1),
  enableTopP: z.boolean(),
  /** from DEFAULT_MAX_TOKENS */
  maxTokens: z.number().int().positive(),
  /** disabled = use model's own default */
  enableMaxTokens: z.boolean(),
  /** streaming provides better UX */
  streamOutput: z.boolean(),
  /** Canonical reasoning selection; endpoint profiles own provider-specific wire values. */
  reasoning_effort: ReasoningEffortOptionSchema,
  /** Summary verbosity, where the endpoint carries one. Absent = the endpoint's own default. */
  reasoning_summary: ReasoningSummarySchema.optional(),
  /** Provider request service tier. Endpoint registry owns native wire values. */
  service_tier: ServiceTierSelectionSchema.optional(),
  // -- Tool use --
  mcpMode: McpModeSchema,
  maxToolCalls: z.number().int().positive(),
  enableMaxToolCalls: z.boolean(),

  // -- Context sources --
  /** One switch for the web tool group (search + URL fetch), whichever side executes it. */
  enableWebSearch: z.boolean(),
  /** Offer the `generate_image` tool to the model (needs a painting model in Settings › Default Model). */
  enableGenerateImage: z.boolean(),

  /** User-defined model parameters (e.g. {"top_k": 40, "repetition_penalty": 1.1}).
   *  Discriminated union on `type` ensures `value` is type-safe:
   *  - `string` → string value, rendered as text input
   *  - `number` → number value, rendered as number spinner
   *  - `boolean` → boolean value, rendered as toggle
   *  - `json` → arbitrary JSON value, rendered as JSON editor */
  customParameters: z.array(
    z.discriminatedUnion('type', [
      z.object({ name: z.string(), type: z.literal('string'), value: z.string() }),
      z.object({ name: z.string(), type: z.literal('number'), value: z.number() }),
      z.object({ name: z.string(), type: z.literal('boolean'), value: z.boolean() }),
      z.object({ name: z.string(), type: z.literal('json'), value: z.unknown() })
    ])
  ),

  /** Per-assistant context-settings override (P2-D assistant layer). Absent or
   *  `null` = inherit the global `chat.context_settings.*` preferences. `null`
   *  is the wire form for "clear the override" — JSON drops `undefined` keys,
   *  and the resolver's `??` chain treats null/undefined alike. */
  contextSettings: ContextSettingsOverrideSchema.nullable().optional()
})
export type AssistantSettings = z.infer<typeof AssistantSettingsSchema>

/** Pre-computed default settings object — avoids runtime parse() on every row conversion */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  temperature: 1.0,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  streamOutput: true,
  reasoning_effort: 'default',
  mcpMode: DEFAULT_MCP_MODE,
  maxToolCalls: 100,
  enableMaxToolCalls: true,
  enableWebSearch: false,
  enableGenerateImage: false,
  customParameters: []
}

// ============================================================================
// Assistant Entity
// ============================================================================

/** Assistant entity ID — UUID v4, generated by the database on insert. */
export const AssistantIdSchema = z.uuidv4()

/**
 * Complete Assistant entity as returned by the API.
 *
 * Row mappers normalize DB-nullable fields before returning this entity.
 * `modelId` and `groupId` are explicitly `.nullable()` because either
 * association may be unset.
 */
export const AssistantSchema = z.strictObject({
  /** Assistant ID — UUID v4, generated by the database on insert. */
  id: AssistantIdSchema,
  /** Display name */
  name: z.string().min(1),
  /** System prompt text or prompt template ID reference */
  prompt: z.string(),
  /** Emoji icon for UI display */
  emoji: z.emoji(),
  /** Long-form description */
  description: z.string(),
  /** Inference settings — model params + context toggles */
  settings: AssistantSettingsSchema,
  /** Default/primary model ID in UniqueModelId format ("providerId::modelId") */
  modelId: UniqueModelIdSchema.nullable(),
  /** Optional group used to organize assistants */
  groupId: GroupIdSchema.nullable(),
  /** Persistent ordering key. Read-only; modified only through order endpoints. */
  orderKey: z.string(),
  /** Ordered MCP server IDs linked through assistant_mcp_server */
  mcpServerIds: z.array(z.string()),
  /** Ordered knowledge base IDs linked through assistant_knowledge_base */
  knowledgeBaseIds: z.array(z.string()),
  /** Creation timestamp (ISO string).
   *  DB column is nullable (SQLite integer), but rowToAssistant always provides a
   *  fallback so the API-level type is non-optional. */
  createdAt: z.iso.datetime(),
  /** Last update timestamp (ISO string). Same nullable-at-DB / non-null-at-API pattern. */
  updatedAt: z.iso.datetime(),
  /**
   * Human-readable model name resolved from the current runtime Model at read
   * time. Read-only embedded field — edits go through `modelId`. Renderer
   * consumers (list / grid / card) display this directly instead of
   * re-resolving the `providerId::modelId` unique id against provider state.
   * `null` when the model row is missing (e.g. user removed the model after
   * binding).
   */
  modelName: z.string().nullable()
})
export type Assistant = z.infer<typeof AssistantSchema>
