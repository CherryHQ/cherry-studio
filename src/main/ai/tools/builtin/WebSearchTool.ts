/**
 * Web search tool — agentic.
 *
 * The model picks search queries or URLs and may call multiple times with
 * refined terms. Provider ids are resolved inside WebSearchService from the
 * user's configured default provider for each capability.
 *
 * Replaces the deleted workflow-style `webSearchToolWithPreExtractedKeywords`
 * factory whose intent analyzer pre-baked queries into the tool itself.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import {
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webFetchInputSchema,
  type WebFetchOutput,
  webFetchOutputSchema,
  webSearchInputSchema,
  type WebSearchOutput,
  webSearchOutputSchema
} from '@shared/ai/builtinTools'
import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('WebSearchTool')

export { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME }

function mapWebSearchOutput(response: WebSearchResponse): WebSearchOutput {
  return response.results.map((result, index) => ({
    id: index + 1,
    title: result.title,
    url: result.url,
    content: result.content
  }))
}

const webSearchTool = tool({
  description: `Search the web for current information, news, and real-time data.

Use this when:
- The user asks about recent events, current prices, or live data
- You need to verify facts you're uncertain about or that may have changed
- The user references something you don't have context on

Don't use for:
- Math, code reasoning, or things you can answer from your training
- Well-known facts unlikely to have changed

You may call this multiple times with different queries to broaden coverage:
- If the topic likely has more authoritative sources in another language
  (English for tech / scientific topics, the local language for regional news,
  Japanese for anime / manga, etc.), repeat the search with the topic translated
  into the most likely source language.
- If the first results miss an angle, refine with synonyms or sub-aspects.

Cite sources by [id] in your final answer.`,
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema,
  // Provider-level constrained decoding where supported. Repair fallback
  // (in AiService) handles providers that don't honour `strict`.
  strict: true,
  execute: async ({ query }, options): Promise<WebSearchOutput> => {
    const { request } = getToolCallContext(options)

    try {
      const webSearchService = application.get('WebSearchService')
      const response = await webSearchService.searchKeywords(
        {
          keywords: [query]
        },
        { signal: request.abortSignal }
      )
      return mapWebSearchOutput(response)
    } catch (error) {
      logger.error('webSearchService.searchKeywords failed', error as Error, {
        query
      })
      return []
    }
  }
})

const webFetchTool = tool({
  description: `Fetch the readable content from one or more known web page URLs.

Use this when:
- You already have specific URLs from the user, prior context, or web__search
- You need page content from an article, documentation page, or reference URL
- Search snippets are not enough and you need the source page text

Don't use this when you only have a topic or question; call web__search first.

Cite sources by [id] in your final answer.`,
  inputSchema: webFetchInputSchema,
  outputSchema: webFetchOutputSchema,
  strict: true,
  execute: async ({ urls }, options): Promise<WebFetchOutput> => {
    const { request } = getToolCallContext(options)

    try {
      const webSearchService = application.get('WebSearchService')
      const response = await webSearchService.fetchUrls(
        {
          urls
        },
        { signal: request.abortSignal }
      )
      return mapWebSearchOutput(response)
    } catch (error) {
      logger.error('webSearchService.fetchUrls failed', error as Error, {
        urls
      })
      return []
    }
  }
})

export function createWebSearchToolEntry(): ToolEntry {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    namespace: 'web',
    description: 'Search the web for current information',
    defer: 'auto',
    tool: webSearchTool,
    applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
  }
}

export function createWebFetchToolEntry(): ToolEntry {
  return {
    name: WEB_FETCH_TOOL_NAME,
    namespace: 'web',
    description: 'Fetch readable content from known web page URLs',
    defer: 'auto',
    tool: webFetchTool,
    applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
  }
}

export type WebSearchToolInput = InferToolInput<typeof webSearchTool>
export type WebSearchToolOutput = InferToolOutput<typeof webSearchTool>
export type WebFetchToolInput = InferToolInput<typeof webFetchTool>
export type WebFetchToolOutput = InferToolOutput<typeof webFetchTool>
