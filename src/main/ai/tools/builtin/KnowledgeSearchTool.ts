/**
 * Knowledge base search tool exposed to the LLM during chat / agent execution.
 *
 * Wraps Main `KnowledgeOrchestrationService.search(baseId, query)` and
 * aggregates results across all knowledge bases attached to the assistant.
 *
 * Mirrors the renderer-side `knowledgeSearchTool` deleted with the legacy
 * `aiCore` layer (commit 188f25478). Differences:
 *   - Iterates `assistant.knowledgeBaseIds` (v2 shared schema) instead of
 *     `assistant.knowledge_bases`.
 *   - Talks to Main `knowledgeOrchestrationService.search(baseId, query)`
 *     directly per (base, question) pair — there is no `processKnowledgeSearch`
 *     in Main.
 *   - Dedupes on `pageContent` (legacy used `metadata.uniqueId` first; v2
 *     `KnowledgeSearchResult.metadata` is a free-form `Record<string, unknown>`
 *     so we fall back to content-equality).
 *   - Output shape matches `KnowledgeSearchResult` not the legacy
 *     `KnowledgeReference` (which carried `file` / `sourceUrl` enriched data
 *     resolved on the renderer side).
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { REFERENCE_PROMPT } from '@shared/config/prompts'
import type { Assistant } from '@shared/data/types/assistant'
import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import type { KnowledgeExtractResults } from '../../utils/extract'

const logger = loggerService.withContext('KnowledgeSearchTool')

type KnowledgeReference = {
  id: number
  pageContent: string
  score: number
  metadata: KnowledgeSearchResult['metadata']
  itemId?: string
  chunkId: string
}

export const knowledgeSearchTool = (
  assistant: Assistant,
  extractedKeywords: KnowledgeExtractResults,
  /** Reserved for future per-topic span correlation; currently unused. */
  _topicId: string,
  userMessage?: string
) =>
  tool({
    description: `Knowledge base search tool for retrieving information from user's private knowledge base. This searches your local collection of documents, web content, notes, and other materials you have stored.

This tool has been configured with search parameters based on the conversation context:
- Prepared queries: ${extractedKeywords.question.map((q) => `"${q}"`).join(', ')}
- Query rewrite: "${extractedKeywords.rewrite}"

You can use this tool as-is, or provide additionalContext to refine the search focus within the knowledge base.`,

    inputSchema: z.object({
      additionalContext: z
        .string()
        .optional()
        .describe('Optional additional context or specific focus to enhance the knowledge search')
    }),

    execute: async ({ additionalContext }): Promise<KnowledgeReference[]> => {
      const knowledgeBaseIds = assistant.knowledgeBaseIds ?? []
      if (knowledgeBaseIds.length === 0) {
        return []
      }

      let finalQueries = [...extractedKeywords.question]

      if (additionalContext?.trim()) {
        finalQueries = [additionalContext.trim()]
      }

      if (finalQueries[0] === 'not_needed' || finalQueries.length === 0) {
        return []
      }

      // Fall back to the original user message if intent extraction yielded
      // nothing useful — same defensive behaviour as the deleted renderer tool.
      if (finalQueries.length === 0 && userMessage?.trim()) {
        finalQueries = [userMessage.trim()]
      }

      const orchestrator = application.get('KnowledgeOrchestrationService')

      // For each base, run every question and flatten the results.
      const perBaseResults = await Promise.all(
        knowledgeBaseIds.map(async (baseId) => {
          const queryResults = await Promise.all(
            finalQueries.map(async (query) => {
              try {
                return await orchestrator.search(baseId, query)
              } catch (error) {
                logger.warn('Knowledge.search failed for base', {
                  baseId,
                  query,
                  error: error instanceof Error ? error.message : String(error)
                })
                return [] as KnowledgeSearchResult[]
              }
            })
          )
          return queryResults.flat()
        })
      )

      // Aggregate, dedupe by pageContent (keeping highest score), sort by score desc.
      const merged = perBaseResults.flat()
      const dedupedByContent = new Map<string, KnowledgeSearchResult>()
      for (const result of merged) {
        const existing = dedupedByContent.get(result.pageContent)
        if (!existing || result.score > existing.score) {
          dedupedByContent.set(result.pageContent, result)
        }
      }
      const sorted = Array.from(dedupedByContent.values()).sort((a, b) => b.score - a.score)

      return sorted.map((result, index) => ({
        id: index + 1,
        pageContent: result.pageContent,
        score: result.score,
        metadata: result.metadata,
        itemId: result.itemId,
        chunkId: result.chunkId
      }))
    },

    toModelOutput: ({ output: results }) => {
      let summary = 'No search needed based on the query analysis.'
      if (results.length > 0) {
        summary = `Found ${results.length} relevant sources. Use [number] format to cite specific information.`
      }

      const referenceContent = `\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``
      const fullInstructions = REFERENCE_PROMPT.replace(
        '{question}',
        "Based on the knowledge references, please answer the user's question with proper citations."
      ).replace('{references}', referenceContent)

      return {
        type: 'content',
        value: [
          {
            type: 'text',
            text: 'This tool searches for relevant information and formats results for easy citation. The returned sources should be cited using [1], [2], etc. format in your response.'
          },
          { type: 'text', text: summary },
          { type: 'text', text: fullInstructions }
        ]
      }
    }
  })

export type KnowledgeSearchToolInput = InferToolInput<ReturnType<typeof knowledgeSearchTool>>
export type KnowledgeSearchToolOutput = InferToolOutput<ReturnType<typeof knowledgeSearchTool>>
