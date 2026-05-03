/**
 * Knowledge base search tool — agentic.
 *
 * The model picks the query and may call multiple times with refined terms.
 * Per-request `assistant.knowledgeBaseIds` flows in via RequestContext, so
 * the tool itself is stateless: one entry, registered once during AiService
 * startup via `registerBuiltinTools(...)`.
 *
 * Replaces the workflow-style `knowledgeSearchTool` factory whose intent
 * analyzer pre-baked queries into the tool itself; that factory and its
 * orchestration plugin were deleted in the same change.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import {
  KB_SEARCH_TOOL_NAME,
  kbSearchInputSchema,
  type KbSearchOutput,
  kbSearchOutputSchema
} from '@shared/ai/builtinTools'
import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { getToolCallContext } from '../context'
import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../types'

const logger = loggerService.withContext('KnowledgeSearchTool')

export { KB_SEARCH_TOOL_NAME }

const kbSearchTool = tool({
  description: `Search the user's private knowledge base — local documents, notes, web clippings.

Use this when:
- The user references "my notes" / "my documents" / their own materials
- The question references topics likely covered in stored documents
- Specific factual lookup that isn't general knowledge

You may call this multiple times with refined queries if the first results are insufficient. Cite sources by [id] in your final answer.`,
  inputSchema: kbSearchInputSchema,
  outputSchema: kbSearchOutputSchema,
  strict: true,
  needsApproval: makeNeedsApproval(KB_SEARCH_TOOL_NAME),
  execute: async ({ query }, options): Promise<KbSearchOutput> => {
    const { request } = getToolCallContext(options)
    const knowledgeBaseIds = request.assistant?.knowledgeBaseIds ?? []
    if (knowledgeBaseIds.length === 0) return []

    const orchestrator = application.get('KnowledgeOrchestrationService')
    const perBaseResults = await Promise.all(
      knowledgeBaseIds.map(async (baseId) => {
        try {
          // TODO: baseId(or base description) AS tool inputschema
          return await orchestrator.search(baseId, query)
        } catch (error) {
          logger.warn('KnowledgeOrchestrationService.search failed', {
            baseId,
            query,
            error: error instanceof Error ? error.message : String(error)
          })
          return [] as KnowledgeSearchResult[]
        }
      })
    )

    // Aggregate, dedupe by content (highest score wins), sort desc.
    const merged = perBaseResults.flat()
    const dedupedByContent = new Map<string, KnowledgeSearchResult>()
    for (const result of merged) {
      const existing = dedupedByContent.get(result.pageContent)
      if (!existing || result.score > existing.score) {
        dedupedByContent.set(result.pageContent, result)
      }
    }
    const sorted = [...dedupedByContent.values()].sort((a, b) => b.score - a.score)

    return sorted.map((result, index) => ({
      id: index + 1,
      content: result.pageContent,
      // Clamp to the schema's [0, 1] range; AI SDK validates the final array
      // against `outputSchema` after this returns.
      score: Math.max(0, Math.min(1, result.score))
    }))
  }
})

export function createKbSearchToolEntry(): ToolEntry {
  return {
    name: KB_SEARCH_TOOL_NAME,
    namespace: BuiltinToolNamespace.Kb,
    description: "Search the user's private knowledge base",
    defer: ToolDefer.Auto,
    capability: ToolCapability.Read,
    tool: kbSearchTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0,
    checkPermissions: () => ({ behavior: 'allow' })
  }
}

export type KnowledgeSearchToolInput = InferToolInput<typeof kbSearchTool>
export type KnowledgeSearchToolOutput = InferToolOutput<typeof kbSearchTool>
