import { getUrlOriginOrFallback } from '@renderer/utils/url'
import { REFERENCE_PROMPT } from '@shared/config/prompts'
import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

export const BUILTIN_WEB_SEARCH_TOOL_NAME = 'builtin_web_search'
export const BUILTIN_FETCH_URLS_TOOL_NAME = 'builtin_fetch_urls'

const MAX_BUILTIN_WEB_SEARCH_QUERIES = 3
const MAX_BUILTIN_FETCH_URLS = 20

function normalizeInputs(inputs: string[], limit: number): string[] {
  const seen = new Set<string>()

  return inputs
    .map((input) => input.trim())
    .filter(Boolean)
    .filter((input) => {
      const key = input.toLocaleLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

function toWebSearchModelOutput(results: WebSearchResponse, action: 'search' | 'fetch') {
  const summary =
    results.results.length > 0
      ? `Found ${results.results.length} relevant sources. Use [number] format to cite specific information.`
      : 'No relevant sources were found.'

  const citationData = results.results.map((result, index) => ({
    number: index + 1,
    title: result.title,
    content: result.content,
    url: getUrlOriginOrFallback(result.url)
  }))

  const referenceContent = `\`\`\`json\n${JSON.stringify(citationData, null, 2)}\n\`\`\``
  const instructions = REFERENCE_PROMPT.replace(
    '{question}',
    "Based on the web results, please answer the user's question with proper citations."
  ).replace('{references}', referenceContent)

  return {
    type: 'content' as const,
    value: [
      {
        type: 'text' as const,
        text:
          action === 'search'
            ? 'This tool searches the web and formats results for citation.'
            : 'This tool fetches URL content and formats results for citation.'
      },
      {
        type: 'text' as const,
        text: summary
      },
      {
        type: 'text' as const,
        text: instructions
      }
    ]
  }
}

export const webSearchTool = () =>
  tool({
    description:
      'Search the web for current information, news, and real-time data. Use focused search queries and cite returned sources as [1], [2], etc.',
    inputSchema: z.object({
      queries: z.array(z.string()).optional().describe('Focused web search queries.'),
      additionalContext: z.string().optional().describe('Single focused query when the model provides legacy input.')
    }),
    execute: async ({ queries, additionalContext }) => {
      const keywords = normalizeInputs(
        queries?.length ? queries : [additionalContext ?? ''],
        MAX_BUILTIN_WEB_SEARCH_QUERIES
      )
      if (keywords.length === 0) {
        throw new Error('Provide at least one search query in `queries` (string array).')
      }

      return window.api.webSearch.searchKeywords({
        keywords
      })
    },
    toModelOutput: ({ output }) => toWebSearchModelOutput(output, 'search')
  })

export const fetchUrlsTool = () =>
  tool({
    description:
      'Fetch and read specific web URLs supplied by the user or conversation. Use this when exact URLs need to be opened or summarized.',
    inputSchema: z.object({
      urls: z.array(z.string()).min(1).describe('Absolute URLs to fetch.')
    }),
    execute: async ({ urls }) => {
      return window.api.webSearch.fetchUrls({
        urls: normalizeInputs(urls, MAX_BUILTIN_FETCH_URLS)
      })
    },
    toModelOutput: ({ output }) => toWebSearchModelOutput(output, 'fetch')
  })

export type WebSearchToolOutput = InferToolOutput<ReturnType<typeof webSearchTool>>
export type WebSearchToolInput = InferToolInput<ReturnType<typeof webSearchTool>>
export type FetchUrlsToolOutput = InferToolOutput<ReturnType<typeof fetchUrlsTool>>
export type FetchUrlsToolInput = InferToolInput<ReturnType<typeof fetchUrlsTool>>
