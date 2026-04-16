/**
 * Assistant migration mappings and transform functions
 *
 * Transforms legacy Redux Assistant/AssistantPreset objects to:
 * - assistant table row (with modelId from model/defaultModel)
 * - junction table rows (assistant_mcp_server, assistant_knowledge_base)
 * - tag/entity_tag rows (via tags[] field)
 *
 * Field mapping:
 * - model/defaultModel -> assistant.modelId (primary model, composite format)
 * - mcpServers[] -> assistant_mcp_server junction rows
 * - knowledge_bases[] -> assistant_knowledge_base junction rows
 * - tags[] -> tag + entity_tag tables
 * - type -> dropped (design flaw)
 * - messages -> dropped (feature removed)
 * - topics -> dropped (decoupled)
 * - content/targetLanguage -> dropped (translation-specific)
 * - enableGenerateImage/enableUrlContext/knowledgeRecognition/webSearchProviderId -> dropped
 * - regularPhrases -> dropped (future: FK IDs)
 */

import type { AssistantInsert } from '@data/db/schemas/assistant'
import type { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'

import { legacyModelToUniqueId } from '../transformers/ModelTransformers'

// ============================================================================
// Old Type Definitions (Source Data Structures)
// ============================================================================

/**
 * Old Model type from Redux state
 * Source: src/renderer/src/types/index.ts
 */
/**
 * Legacy data may have incomplete model objects (e.g. missing provider or group).
 * All fields are optional to handle gracefully.
 */
export interface OldModel {
  id?: string
  provider?: string
  name?: string
  group?: string
}

/**
 * Old AssistantSettings from Redux state
 * Source: src/renderer/src/types/index.ts
 */
export interface OldAssistantSettings {
  maxTokens?: number
  enableMaxTokens?: boolean
  temperature?: number
  enableTemperature?: boolean
  topP?: number
  enableTopP?: boolean
  contextCount?: number
  streamOutput?: boolean
  defaultModel?: OldModel
  customParameters?: {
    name: string
    value: string | number | boolean | object
    type: 'string' | 'number' | 'boolean' | 'json'
  }[]
  reasoning_effort?: string
  qwenThinkMode?: boolean
  toolUseMode?: 'function' | 'prompt'
  maxToolCalls?: number
  enableMaxToolCalls?: boolean
}

/** Old KnowledgeBase reference from Redux state */
export interface OldKnowledgeBase {
  id?: string
  [key: string]: unknown
}

/** Old MCPServer reference from Redux state */
export interface OldMcpServer {
  id?: string
  [key: string]: unknown
}

/**
 * Old Assistant type from Redux state.
 * Source: src/renderer/src/types/index.ts
 *
 * Fields use nullable unions (`| null`) because legacy Redux data
 * may store explicit nulls. All fields except `id` are optional
 * to handle incomplete or corrupt data gracefully.
 *
 * Dropped fields (documented for traceability):
 * topics, messages, content, targetLanguage,
 * enableGenerateImage, enableUrlContext, knowledgeRecognition,
 * webSearchProviderId, regularPhrases
 */
export interface OldAssistant {
  id: string
  name?: string | null
  prompt?: string | null
  emoji?: string | null
  description?: string | null
  type?: string | null
  model?: OldModel | null
  defaultModel?: OldModel | null
  settings?: Partial<OldAssistantSettings> | null
  mcpMode?: string | null
  mcpServers?: OldMcpServer[] | null
  knowledge_bases?: OldKnowledgeBase[] | null
  enableWebSearch?: boolean | null
  tags?: string[] | null
}

// ============================================================================
// Transform Result
// ============================================================================

export interface AssistantTransformResult {
  assistant: AssistantInsert
  mcpServers: (typeof assistantMcpServerTable.$inferInsert)[]
  knowledgeBases: (typeof assistantKnowledgeBaseTable.$inferInsert)[]
  tags: string[]
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Extract the primary/default model ID from legacy model or defaultModel fields.
 * Legacy Redux stores full Model objects: { id, provider, name, ... }
 * v2 uses composite IDs in `providerId::modelId` format.
 * Prefers `model` over `defaultModel` (defaultModel is the settings-level fallback).
 */
function extractPrimaryModelId(source: OldAssistant): string | null {
  return legacyModelToUniqueId(source.model) ?? legacyModelToUniqueId(source.defaultModel)
}

function extractMcpServerIds(source: OldAssistant): string[] {
  if (!Array.isArray(source.mcpServers)) return []
  return source.mcpServers.reduce<string[]>((ids, s) => {
    if (s.id) ids.push(s.id)
    return ids
  }, [])
}

function extractKnowledgeBaseIds(source: OldAssistant): string[] {
  if (!Array.isArray(source.knowledge_bases)) return []
  return source.knowledge_bases.reduce<string[]>((ids, kb) => {
    if (kb.id) ids.push(kb.id)
    return ids
  }, [])
}

/**
 * Transform a legacy Redux Assistant to v2 assistant table row + junction rows.
 *
 * @param source - Legacy assistant object (may have additional fields from different Redux versions)
 */
export function transformAssistant(source: OldAssistant): AssistantTransformResult {
  const assistantId = source.id

  const primaryModelId = extractPrimaryModelId(source)
  const mcpServerIds = extractMcpServerIds(source)
  const knowledgeBaseIds = extractKnowledgeBaseIds(source)

  // Build settings JSON: merge legacy top-level fields into settings object
  const legacySettings: Record<string, unknown> = source.settings ? { ...source.settings } : {}
  // Migrate top-level fields into settings (skip null/undefined)
  if (source.mcpMode != null) legacySettings.mcpMode = source.mcpMode
  if (source.enableWebSearch != null) legacySettings.enableWebSearch = source.enableWebSearch

  return {
    assistant: {
      id: assistantId,
      name: source.name || 'Unnamed Assistant',
      prompt: source.prompt ?? null,
      emoji: source.emoji ?? null,
      description: source.description ?? null,
      modelId: primaryModelId ?? null,
      settings: Object.keys(legacySettings).length > 0 ? (legacySettings as AssistantInsert['settings']) : null
    },
    mcpServers: mcpServerIds.map((mcpServerId) => ({ assistantId, mcpServerId })),
    knowledgeBases: knowledgeBaseIds.map((knowledgeBaseId) => ({ assistantId, knowledgeBaseId })),
    tags: Array.isArray(source.tags)
      ? source.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : []
  }
}
