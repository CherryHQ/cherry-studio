/**
 * Knowledge base search tool — agentic.
 *
 * The model picks the query and the target `baseIds` (typically after calling
 * `kb__list` to discover which bases are relevant). Per-request
 * `assistant.knowledgeBaseIds` flows in via RequestContext: when non-empty it
 * scopes which base IDs the tool will accept. The tool itself is stateless;
 * registered once during AiService startup via `registerBuiltinTools(...)`.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import {
  KB_SEARCH_TOOL_NAME,
  kbSearchInputSchema,
  type KbSearchOutput,
  kbSearchOutputSchema
} from '@shared/ai/builtinTools'
import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('KnowledgeSearchTool')

export { KB_SEARCH_TOOL_NAME }

const kbSearchTool = tool({
  description: `Search the user's private knowledge base — local documents, notes, web clippings.

Use this when:
- The user references "my notes" / "my documents" / their own materials
- The question references topics likely covered in stored documents
- Specific factual lookup that isn't general knowledge

Workflow: call kb__list first to discover available bases and their contents, then call this tool with the chosen baseIds. You may call this multiple times with refined queries or different baseIds if the first results are insufficient. Cite sources by [id] in your final answer.`,
  inputSchema: kbSearchInputSchema,
  outputSchema: kbSearchOutputSchema,
  strict: true,
  execute: async ({ query, baseIds }, options): Promise<KbSearchOutput> => {
    const { request } = getToolCallContext(options)
    const allowedIds = request.assistant?.knowledgeBaseIds ?? []
    const targetIds = allowedIds.length > 0 ? baseIds.filter((id) => allowedIds.includes(id)) : baseIds

    if (targetIds.length === 0) return []

    if (allowedIds.length > 0 && targetIds.length < baseIds.length) {
      const rejected = baseIds.filter((id) => !allowedIds.includes(id))
      logger.warn('Dropped baseIds outside the assistant scope', { rejected, allowedIds })
    }

    const orchestrator = application.get('KnowledgeOrchestrationService')
    const perBaseResults = await Promise.all(
      targetIds.map(async (baseId) => {
        try {
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
  },
  toModelOutput: ({ output }) => {
    if (output.length === 0) {
      return {
        type: 'text' as const,
        value:
          'No matches in the requested knowledge bases. If you are not sure which bases to search, call kb__list first to inspect available bases and their sample sources, then retry kb__search with refined baseIds or query.'
      }
    }
    return { type: 'json' as const, value: output }
  }
})

export function createKbSearchToolEntry(): ToolEntry {
  return {
    name: KB_SEARCH_TOOL_NAME,
    namespace: 'kb',
    description: "Search the user's private knowledge base",
    defer: 'auto',
    tool: kbSearchTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeSearchToolInput = InferToolInput<typeof kbSearchTool>
export type KnowledgeSearchToolOutput = InferToolOutput<typeof kbSearchTool>
