/**
 * User Assistant table schema
 *
 * Stores user-created assistants and presets.
 * - type='assistant': Regular user assistants
 * - type='preset': Assistant presets (templates)
 * - isDefault: Marks the default assistant (exactly one)
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

// ═══════════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

/** Assistant settings stored as JSON blob */
export interface AssistantSettingsJson {
  maxTokens?: number
  enableMaxTokens?: boolean
  temperature?: number
  enableTemperature?: boolean
  topP?: number
  enableTopP?: boolean
  contextCount?: number
  streamOutput?: boolean
  customParameters?: Array<{ name: string; value: string | number | boolean | object; type: string }>
  reasoning_effort?: string
  reasoning_effort_cache?: string
  qwenThinkMode?: boolean
  toolUseMode?: 'function' | 'prompt'
}

/** MCP Server reference (serialized subset) */
export interface McpServerRef {
  name: string
  type?: string
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  isActive?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// Table Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const userAssistantTable = sqliteTable(
  'user_assistant',
  {
    id: uuidPrimaryKey(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────────

    /** Original assistant ID from legacy data */
    assistantId: text().notNull().unique(),

    /** Display name */
    name: text().notNull(),

    /** Description */
    description: text(),

    /** Emoji icon */
    emoji: text(),

    /** System prompt */
    prompt: text().default(''),

    /** Type: 'assistant' for regular, 'preset' for templates */
    type: text().notNull().default('assistant'),

    // ─────────────────────────────────────────────────────────────────────────────
    // Model Reference (UniqueModelId format: "providerId::modelId")
    // ─────────────────────────────────────────────────────────────────────────────

    /** Bound model (UniqueModelId) */
    modelId: text(),

    /** Default model for preset (UniqueModelId) */
    defaultModelId: text(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Settings (JSON blob)
    // ─────────────────────────────────────────────────────────────────────────────

    /** Assistant settings */
    settings: text({ mode: 'json' }).$type<AssistantSettingsJson>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Features
    // ─────────────────────────────────────────────────────────────────────────────

    /** Enable web search */
    enableWebSearch: integer({ mode: 'boolean' }).default(false),

    /** Web search provider ID */
    webSearchProviderId: text(),

    /** Enable URL context */
    enableUrlContext: integer({ mode: 'boolean' }).default(false),

    /** Enable image generation */
    enableGenerateImage: integer({ mode: 'boolean' }).default(false),

    /** Enable memory */
    enableMemory: integer({ mode: 'boolean' }).default(false),

    /** Knowledge recognition mode */
    knowledgeRecognition: text().default('off'),

    // ─────────────────────────────────────────────────────────────────────────────
    // MCP Configuration
    // ─────────────────────────────────────────────────────────────────────────────

    /** MCP mode: 'disabled' | 'auto' | 'manual' */
    mcpMode: text().default('disabled'),

    /** MCP server references (JSON) */
    mcpServers: text({ mode: 'json' }).$type<McpServerRef[]>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Knowledge
    // ─────────────────────────────────────────────────────────────────────────────

    /** Associated knowledge bases (JSON) */
    knowledgeBases: text({ mode: 'json' }).$type<Array<{ id: string; name?: string }>>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Tags
    // ─────────────────────────────────────────────────────────────────────────────

    /** Tags (JSON array) */
    tags: text({ mode: 'json' }).$type<string[]>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Regular Phrases
    // ─────────────────────────────────────────────────────────────────────────────

    /** Quick phrases (JSON array) */
    regularPhrases: text({ mode: 'json' }).$type<Array<{ title: string; content: string }>>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Preset-specific Fields
    // ─────────────────────────────────────────────────────────────────────────────

    /** Preset group (JSON array, preset-only) */
    group: text({ mode: 'json' }).$type<string[]>(),

    // ─────────────────────────────────────────────────────────────────────────────
    // Status and Ordering
    // ─────────────────────────────────────────────────────────────────────────────

    /** Whether this is the default assistant */
    isDefault: integer({ mode: 'boolean' }).default(false),

    /** Sort order in UI */
    sortOrder: integer().default(0),

    ...createUpdateTimestamps
  },
  (t) => [
    index('user_assistant_type_idx').on(t.type),
    index('user_assistant_default_idx').on(t.isDefault),
    index('user_assistant_sort_idx').on(t.sortOrder)
  ]
)

// Export table types
export type UserAssistant = typeof userAssistantTable.$inferSelect
export type NewUserAssistant = typeof userAssistantTable.$inferInsert
