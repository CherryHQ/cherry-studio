/**
 * Assistant migration mappings and transform functions
 *
 * Transforms legacy Redux Assistant/AssistantPreset objects to:
 * - assistant table row
 * - junction table rows (assistant_model, assistant_mcp_server, assistant_knowledge_base)
 *
 * Field mapping:
 * - model/defaultModel -> assistant_model junction rows
 * - mcpServers[] -> assistant_mcp_server junction rows
 * - knowledge_bases[] -> assistant_knowledge_base junction rows
 * - type -> dropped (design flaw)
 * - messages -> dropped (feature removed)
 * - topics -> dropped (decoupled)
 * - tags -> dropped (use tagging table, handled separately)
 * - content/targetLanguage -> dropped (translation-specific)
 * - enableGenerateImage/enableUrlContext/knowledgeRecognition/webSearchProviderId -> dropped
 * - regularPhrases -> dropped (future: FK IDs)
 */

import type { AssistantInsert } from '@data/db/schemas/assistant'
import type {
  assistantKnowledgeBaseTable,
  assistantMcpServerTable,
  assistantModelTable
} from '@data/db/schemas/assistantRelations'

import { buildCompositeModelId } from '../../utils/modelIdUtils'

export interface AssistantTransformResult {
  assistant: AssistantInsert
  models: (typeof assistantModelTable.$inferInsert)[]
  mcpServers: (typeof assistantMcpServerTable.$inferInsert)[]
  knowledgeBases: (typeof assistantKnowledgeBaseTable.$inferInsert)[]
}

function toNullable<T>(value: unknown): T | null {
  return (value ?? null) as T | null
}

/**
 * Extract composite model IDs from legacy model and defaultModel fields.
 * Legacy Redux stores full Model objects: { id, provider, name, ... }
 * v2 uses composite IDs in `providerId::modelId` format.
 * Deduplicates and filters out empty/null values.
 */
function extractModelIds(source: Record<string, unknown>): string[] {
  const ids: string[] = []

  const model = source.model as Record<string, unknown> | undefined
  if (model) {
    const compositeId = buildCompositeModelId(model)
    if (compositeId) ids.push(compositeId)
  }

  const defaultModel = source.defaultModel as Record<string, unknown> | undefined
  if (defaultModel) {
    const compositeId = buildCompositeModelId(defaultModel)
    if (compositeId && !ids.includes(compositeId)) ids.push(compositeId)
  }

  return ids
}

function extractMcpServerIds(source: Record<string, unknown>): string[] {
  if (!Array.isArray(source.mcpServers)) return []
  return (source.mcpServers as Array<Record<string, unknown>>).map((s) => s.id as string).filter(Boolean)
}

function extractKnowledgeBaseIds(source: Record<string, unknown>): string[] {
  if (!Array.isArray(source.knowledge_bases)) return []
  return (source.knowledge_bases as Array<Record<string, unknown>>).map((kb) => kb.id as string).filter(Boolean)
}

export function transformAssistant(source: Record<string, unknown>): AssistantTransformResult {
  const assistantId = source.id as string

  const modelIds = extractModelIds(source)
  const mcpServerIds = extractMcpServerIds(source)
  const knowledgeBaseIds = extractKnowledgeBaseIds(source)

  return {
    assistant: {
      id: assistantId,
      name: (source.name as string) || 'Unnamed Assistant',
      prompt: toNullable(source.prompt),
      emoji: toNullable(source.emoji),
      description: toNullable(source.description),
      settings: toNullable(source.settings),
      mcpMode: toNullable(source.mcpMode),
      enableWebSearch: (source.enableWebSearch as boolean) ?? false,
      enableMemory: (source.enableMemory as boolean) ?? false
    },
    models: modelIds.map((modelId, i) => ({ assistantId, modelId, sortOrder: i })),
    mcpServers: mcpServerIds.map((mcpServerId, i) => ({ assistantId, mcpServerId, sortOrder: i })),
    knowledgeBases: knowledgeBaseIds.map((knowledgeBaseId, i) => ({ assistantId, knowledgeBaseId, sortOrder: i }))
  }
}
