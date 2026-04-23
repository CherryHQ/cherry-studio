import { loggerService } from '@logger'
import { webSearchService } from '@renderer/services/WebSearchService'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import { getUrlOriginOrFallback } from '@renderer/utils/url'
import { REFERENCE_PROMPT } from '@shared/config/prompts'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

const logger = loggerService.withContext('WebSearchTool')

export const BUILTIN_WEB_SEARCH_TOOL_NAME = 'builtin_web_search'

const MAX_BUILTIN_WEB_SEARCH_QUERIES = 3

function normalizeWebSearchQueries(questions: string[]): string[] {
  if (questions[0] === 'not_needed') {
    return ['not_needed']
  }

  const seen = new Set<string>()

  return questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
    .filter((question) => {
      const key = question.toLocaleLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .slice(0, MAX_BUILTIN_WEB_SEARCH_QUERIES)
}

/**
 * 使用预提取关键词的网络搜索工具
 * 这个工具直接使用插件阶段分析的搜索意图，避免重复分析
 */
export const webSearchToolWithPreExtractedKeywords = (
  webSearchProviderId: WebSearchProvider['id'],
  extractedKeywords: {
    question: string[]
    links?: string[]
  },
  requestId: string
) => {
  let cachedSearchResultsPromise: Promise<WebSearchProviderResponse> | undefined

  return tool({
    description: `Web search tool for finding current information, news, and real-time data from the internet.

This tool has been configured with search parameters based on the conversation context:
- Prepared queries: ${extractedKeywords.question.map((q) => `"${q}"`).join(', ')}${
      extractedKeywords.links?.length
        ? `
- Relevant URLs: ${extractedKeywords.links.join(', ')}`
        : ''
    }

You can use this tool as-is to search with the prepared queries, or provide additionalContext to refine or replace the search terms.`,

    inputSchema: z.object({
      additionalContext: z
        .string()
        .optional()
        .describe('Optional additional context, keywords, or specific focus to enhance the search')
    }),

    execute: async ({ additionalContext }) => {
      if (cachedSearchResultsPromise) {
        return cachedSearchResultsPromise
      }

      let finalQueries = normalizeWebSearchQueries(extractedKeywords.question)

      if (additionalContext?.trim()) {
        // 如果大模型提供了额外上下文，使用更具体的描述
        const cleanContext = additionalContext.trim()
        if (cleanContext) {
          finalQueries = normalizeWebSearchQueries([cleanContext])
        }
      }

      // 检查是否需要搜索
      if (finalQueries.length === 0 || finalQueries[0] === 'not_needed') {
        return { query: '', results: [] }
      }

      const webSearchProvider = await webSearchService.getWebSearchProviderAsync(webSearchProviderId)

      if (!webSearchProvider) {
        logger.warn('Skip web search because provider is unavailable', {
          webSearchProviderId,
          requestId
        })
        return { query: '', results: [] }
      }

      // 构建 ExtractResults 结构用于 processWebsearch
      const extractResults: ExtractResults = {
        websearch: {
          question: finalQueries,
          links: extractedKeywords.links
        }
      }

      cachedSearchResultsPromise = webSearchService.processWebsearch(webSearchProvider, extractResults, requestId)
      try {
        return await cachedSearchResultsPromise
      } catch (error) {
        cachedSearchResultsPromise = undefined
        throw error
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
        url: getUrlOriginOrFallback(result.url)
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
          {
            type: 'text',
            text: summary
          },
          {
            type: 'text',
            text: fullInstructions
          }
        ]
      }
    }
  })
}

export type WebSearchToolOutput = InferToolOutput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
export type WebSearchToolInput = InferToolInput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
