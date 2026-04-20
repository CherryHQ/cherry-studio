/**
 * Web search tool exposed to the LLM during chat / agent execution.
 *
 * Wraps Main `webSearchService.search()`, so the tool runs entirely in the
 * Main process — no IPC round-trip — and inherits the OTel `WebSearch` span
 * via @TraceMethod once invoked under an active context (e.g. from
 * `telemetryPlugin`).
 *
 * Mirrors the renderer-side `webSearchToolWithPreExtractedKeywords` deleted
 * with the legacy `aiCore` layer (commit 188f25478). Differences:
 *   - Uses Main `webSearchService.search({ providerId, questions, requestId })`
 *     instead of the deleted renderer `processWebsearch(provider, extractResults, requestId)`.
 *   - Compression / RAG / cutoff is applied inside the Main service via
 *     `postProcessWebSearchResponse`, not here.
 *   - Summarize-mode (`questions[0] === 'summarize'` + links) fans out to
 *     `fetchWebSearchContent` in parallel and returns the scraped pages as
 *     search results, matching the renderer original's semantics.
 */

import { loggerService } from '@logger'
import { fetchWebSearchContent } from '@main/services/webSearch/utils/fetchContent'
import { webSearchService } from '@main/services/webSearch/WebSearchService'
import { REFERENCE_PROMPT } from '@shared/config/prompts'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { WebSearchResponse, WebSearchResult } from '@shared/data/types/webSearch'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

const logger = loggerService.withContext('WebSearchTool')

/**
 * Build a `web_search` tool pre-configured with intent-extracted queries.
 *
 * The `searchOrchestrationPlugin` runs the LLM intent analyser before each
 * request and feeds the extracted queries into this factory. The LLM may
 * still pass `additionalContext` to refine or replace the queries.
 */
export const webSearchToolWithPreExtractedKeywords = (
  providerId: WebSearchProviderId,
  extractedKeywords: {
    question: string[]
    links?: string[]
  },
  requestId: string
) =>
  tool({
    description: `Web search tool for finding current information, news, and real-time data from the internet.

This tool has been configured with search parameters based on the conversation context:
- Prepared queries: ${extractedKeywords.question.map((q) => `"${q}"`).join(', ')}${
      extractedKeywords.links?.length ? `\n- Relevant URLs: ${extractedKeywords.links.join(', ')}` : ''
    }

You can use this tool as-is to search with the prepared queries, or provide additionalContext to refine or replace the search terms.`,

    inputSchema: z.object({
      additionalContext: z
        .string()
        .optional()
        .describe('Optional additional context, keywords, or specific focus to enhance the search')
    }),

    execute: async ({ additionalContext }) => {
      let finalQueries = [...extractedKeywords.question]

      if (additionalContext?.trim()) {
        finalQueries = [additionalContext.trim()]
      }

      // Skip when intent analyser said no search is needed.
      if (finalQueries[0] === 'not_needed' || finalQueries.length === 0) {
        return { query: '', results: [] } satisfies WebSearchResponse
      }

      // Summarize mode: intent analyser detected the user pasted / referenced
      // URLs and wants them summarized. Scrape each URL directly instead of
      // running them through the search provider.
      const links = extractedKeywords.links
      if (finalQueries[0] === 'summarize' && links && links.length > 0) {
        const settled = await Promise.allSettled(links.map((url) => fetchWebSearchContent(url, false)))
        const results: WebSearchResult[] = settled.map((result, index) =>
          result.status === 'fulfilled'
            ? result.value
            : { title: 'Error', url: links[index], content: 'No content found' }
        )
        return { query: 'summaries', results } satisfies WebSearchResponse
      }

      try {
        return await webSearchService.search({
          providerId,
          questions: finalQueries,
          requestId
        })
      } catch (error) {
        logger.error('webSearchService.search failed', error as Error, { providerId, requestId })
        return { query: finalQueries.join(' | '), results: [] } satisfies WebSearchResponse
      }
    },

    toModelOutput: ({ output: results }) => {
      let summary = 'No search needed based on the query analysis.'
      if (results.query && results.results.length > 0) {
        summary = `Found ${results.results.length} relevant sources. Use [number] format to cite specific information.`
      }

      const citationData = results.results.map((result, index) => ({
        number: index + 1,
        title: result.title,
        content: result.content,
        url: result.url
      }))

      const referenceContent = `\`\`\`json\n${JSON.stringify(citationData, null, 2)}\n\`\`\``
      const fullInstructions = REFERENCE_PROMPT.replace(
        '{question}',
        "Based on the search results, please answer the user's question with proper citations."
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

export type WebSearchToolInput = InferToolInput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
export type WebSearchToolOutput = InferToolOutput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
