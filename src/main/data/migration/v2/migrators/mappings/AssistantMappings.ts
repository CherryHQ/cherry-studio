/**
 * Assistant Mappings - Transformation functions for Redux → SQLite migration
 *
 * Converts legacy Assistant and AssistantPreset types to UserAssistant schema format.
 *
 * ## Data Flow:
 * - Source: Redux `assistants` slice (assistants[], defaultAssistant, presets[])
 * - Target: SQLite `user_assistant` table
 */

import type { AssistantSettingsJson, McpServerRef, NewUserAssistant } from '@data/db/schemas/userAssistant'
import { createUniqueModelId } from '@shared/data/types/model'

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy Type Definitions (Source Data)
// ═══════════════════════════════════════════════════════════════════════════════

/** Legacy Model reference (subset of fields used in assistant) */
export interface OldModelRef {
  id: string
  providerId: string
  name?: string
}

/** Legacy Assistant from Redux */
export interface OldAssistant {
  id: string
  name: string
  prompt: string
  type: string
  emoji?: string
  description?: string
  model?: OldModelRef
  defaultModel?: OldModelRef
  settings?: OldAssistantSettings
  messages?: Array<{ role: string; content: string }>
  enableWebSearch?: boolean
  webSearchProviderId?: string
  enableUrlContext?: boolean
  enableGenerateImage?: boolean
  mcpMode?: string
  mcpServers?: OldMcpServer[]
  knowledgeRecognition?: string
  regularPhrases?: Array<{ title: string; content: string }>
  tags?: string[]
  enableMemory?: boolean
  knowledge_bases?: Array<{ id: string; name?: string }>
  // topics are NOT migrated here (handled by ChatMigrator)
  topics?: unknown[]
}

/** Legacy AssistantSettings */
export interface OldAssistantSettings {
  maxTokens?: number
  enableMaxTokens?: boolean
  temperature?: number
  enableTemperature?: boolean
  topP?: number
  enableTopP?: boolean
  contextCount?: number
  streamOutput?: boolean
  defaultModel?: OldModelRef
  customParameters?: Array<{ name: string; value: string | number | boolean | object; type: string }>
  reasoning_effort?: string
  reasoning_effort_cache?: string
  qwenThinkMode?: boolean
  toolUseMode?: 'function' | 'prompt'
}

/** Legacy MCP Server */
export interface OldMcpServer {
  name: string
  type?: string
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  isActive?: boolean
}

/** Legacy AssistantPreset (same as Assistant minus 'model', plus 'group') */
export interface OldAssistantPreset extends OldAssistant {
  group?: string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transformation Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transform a legacy Assistant to NewUserAssistant format
 */
export function transformAssistant(
  legacy: OldAssistant,
  sortOrder: number,
  isDefault: boolean = false
): NewUserAssistant {
  return {
    assistantId: legacy.id,
    name: legacy.name,
    description: legacy.description ?? null,
    emoji: legacy.emoji ?? null,
    prompt: legacy.prompt ?? '',
    type: 'assistant',
    modelId: buildModelId(legacy.model),
    defaultModelId: buildModelId(legacy.defaultModel ?? legacy.settings?.defaultModel),
    settings: buildSettings(legacy.settings),
    enableWebSearch: legacy.enableWebSearch ?? false,
    webSearchProviderId: legacy.webSearchProviderId ?? null,
    enableUrlContext: legacy.enableUrlContext ?? false,
    enableGenerateImage: legacy.enableGenerateImage ?? false,
    enableMemory: legacy.enableMemory ?? false,
    knowledgeRecognition: legacy.knowledgeRecognition ?? 'off',
    mcpMode: legacy.mcpMode ?? getEffectiveMcpMode(legacy),
    mcpServers: buildMcpServers(legacy.mcpServers),
    knowledgeBases: legacy.knowledge_bases ?? null,
    tags: legacy.tags ?? null,
    regularPhrases: legacy.regularPhrases ?? null,
    group: null,
    isDefault,
    sortOrder
  }
}

/**
 * Transform a legacy AssistantPreset to NewUserAssistant format
 */
export function transformPreset(legacy: OldAssistantPreset, sortOrder: number): NewUserAssistant {
  return {
    assistantId: legacy.id,
    name: legacy.name,
    description: legacy.description ?? null,
    emoji: legacy.emoji ?? null,
    prompt: legacy.prompt ?? '',
    type: 'preset',
    modelId: null, // Presets don't have a bound model
    defaultModelId: buildModelId(legacy.defaultModel ?? legacy.settings?.defaultModel),
    settings: buildSettings(legacy.settings),
    enableWebSearch: legacy.enableWebSearch ?? false,
    webSearchProviderId: legacy.webSearchProviderId ?? null,
    enableUrlContext: legacy.enableUrlContext ?? false,
    enableGenerateImage: legacy.enableGenerateImage ?? false,
    enableMemory: legacy.enableMemory ?? false,
    knowledgeRecognition: legacy.knowledgeRecognition ?? 'off',
    mcpMode: legacy.mcpMode ?? getEffectiveMcpMode(legacy),
    mcpServers: buildMcpServers(legacy.mcpServers),
    knowledgeBases: legacy.knowledge_bases ?? null,
    tags: legacy.tags ?? null,
    regularPhrases: legacy.regularPhrases ?? null,
    group: legacy.group ?? null,
    isDefault: false,
    sortOrder
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a UniqueModelId string from a legacy model reference
 * Returns null if no model reference is available
 */
function buildModelId(model?: OldModelRef): string | null {
  if (!model?.id || !model?.providerId) return null
  try {
    return createUniqueModelId(model.providerId, model.id)
  } catch {
    return null
  }
}

/**
 * Build AssistantSettingsJson from legacy settings
 * Strips the defaultModel field (moved to separate column)
 */
function buildSettings(settings?: OldAssistantSettings): AssistantSettingsJson | null {
  if (!settings) return null

  const result: AssistantSettingsJson = {}
  let hasValue = false

  if (settings.maxTokens != null) {
    result.maxTokens = settings.maxTokens
    hasValue = true
  }
  if (settings.enableMaxTokens != null) {
    result.enableMaxTokens = settings.enableMaxTokens
    hasValue = true
  }
  if (settings.temperature != null) {
    result.temperature = settings.temperature
    hasValue = true
  }
  if (settings.enableTemperature != null) {
    result.enableTemperature = settings.enableTemperature
    hasValue = true
  }
  if (settings.topP != null) {
    result.topP = settings.topP
    hasValue = true
  }
  if (settings.enableTopP != null) {
    result.enableTopP = settings.enableTopP
    hasValue = true
  }
  if (settings.contextCount != null) {
    result.contextCount = settings.contextCount
    hasValue = true
  }
  if (settings.streamOutput != null) {
    result.streamOutput = settings.streamOutput
    hasValue = true
  }
  if (settings.customParameters != null) {
    result.customParameters = settings.customParameters
    hasValue = true
  }
  if (settings.reasoning_effort != null) {
    result.reasoning_effort = settings.reasoning_effort
    hasValue = true
  }
  if (settings.reasoning_effort_cache != null) {
    result.reasoning_effort_cache = settings.reasoning_effort_cache
    hasValue = true
  }
  if (settings.qwenThinkMode != null) {
    result.qwenThinkMode = settings.qwenThinkMode
    hasValue = true
  }
  if (settings.toolUseMode != null) {
    result.toolUseMode = settings.toolUseMode
    hasValue = true
  }

  // Intentionally omit defaultModel - it's stored as a separate column (defaultModelId)

  return hasValue ? result : null
}

/**
 * Build McpServerRef array from legacy MCP servers
 */
function buildMcpServers(servers?: OldMcpServer[]): McpServerRef[] | null {
  if (!servers || servers.length === 0) return null

  return servers.map((s) => ({
    name: s.name,
    type: s.type,
    description: s.description,
    baseUrl: s.baseUrl,
    command: s.command,
    args: s.args,
    env: s.env,
    isActive: s.isActive
  }))
}

/**
 * Get effective MCP mode for backward compatibility
 * Legacy assistants without mcpMode default based on mcpServers presence
 */
function getEffectiveMcpMode(assistant: OldAssistant): string {
  return (assistant.mcpServers?.length ?? 0) > 0 ? 'manual' : 'disabled'
}
