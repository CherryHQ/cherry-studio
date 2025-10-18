import { loggerService } from '@logger'
import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import WebSearchService from '@renderer/services/WebSearchService'
import { ProviderSpecificParams, WebSearchProviderResponse } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import { z } from 'zod'

const logger = loggerService.withContext('TavilySearchTool')

/**
 * Tavily 专用搜索工具 - 暴露 Tavily 的高级搜索能力给 LLM
 * 支持 AI-powered answers、Search depth control、Topic filtering 等功能
 */
export const tavilySearchTool = (requestId: string) => {
  const webSearchProvider = WebSearchService.getWebSearchProvider('tavily')

  if (!webSearchProvider) {
    throw new Error('Tavily provider not found or not configured')
  }

  return tool({
    name: 'builtin_tavily_search',
    description: `AI-powered search using Tavily with direct answers and comprehensive content extraction.

Key Features:
- Direct AI Answer: Get a concise, factual answer extracted from search results
- Search Depth: Choose between basic (fast) or advanced (comprehensive) search
- Topic Focus: Filter by general, news, or finance topics
- Full Content: Access complete webpage content, not just snippets
- Rich Media: Optionally include relevant images from search results

Best for: Quick factual answers, news monitoring, financial research, and comprehensive content analysis.`,

    inputSchema: z.object({
      query: z.string().describe('The search query - be specific and clear'),
      maxResults: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Maximum number of results to return (1-20, default: 5)'),
      topic: z
        .enum(['general', 'news', 'finance'])
        .optional()
        .describe('Topic filter: general (default), news (latest news), or finance (financial/market data)'),
      searchDepth: z
        .enum(['basic', 'advanced'])
        .optional()
        .describe('Search depth: basic (faster, top results) or advanced (slower, more comprehensive)'),
      includeAnswer: z
        .boolean()
        .optional()
        .describe('Include AI-generated direct answer extracted from results (default: true)'),
      includeRawContent: z
        .boolean()
        .optional()
        .describe('Include full webpage content instead of just snippets (default: true)'),
      includeImages: z.boolean().optional().describe('Include relevant images from search results (default: false)')
    }),

    execute: async (params, { abortSignal }) => {
      try {
        // 构建 provider 特定参数
        const providerParams: ProviderSpecificParams = {
          tavily: {
            topic: params.topic,
            searchDepth: params.searchDepth,
            includeAnswer: params.includeAnswer,
            includeRawContent: params.includeRawContent,
            includeImages: params.includeImages
          }
        }

        // 构建 ExtractResults 结构
        const extractResults: ExtractResults = {
          websearch: {
            question: [params.query]
          }
        }

        // 统一调用 processWebsearch - 保留所有中间件（时间戳、黑名单、tracing、压缩）
        const finalResults: WebSearchProviderResponse = await WebSearchService.processWebsearch(
          webSearchProvider,
          extractResults,
          requestId,
          abortSignal,
          providerParams
        )

        logger.info(`Tavily search completed: ${finalResults.results.length} results for "${params.query}"`)

        return finalResults
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          logger.info('Tavily search aborted')
          throw error
        }
        logger.error('Tavily search failed:', error as Error)
        throw new Error(`Tavily search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    },

    toModelOutput: (results) => {
      let summary = 'No search results found.'
      if (results.query && results.results.length > 0) {
        summary = `Found ${results.results.length} relevant sources using Tavily AI search. Use [number] format to cite specific information.`
      }

      const citationData = results.results.map((result, index) => {
        const citation: any = {
          number: index + 1,
          title: result.title,
          content: result.content,
          url: result.url
        }

        // 添加 Tavily 特有的元数据
        if ('answer' in result && result.answer) {
          citation.answer = result.answer // Tavily 的直接答案
        }
        if ('images' in result && result.images && result.images.length > 0) {
          citation.images = result.images // Tavily 的图片
        }
        if ('score' in result && result.score !== undefined) {
          citation.score = result.score
        }

        return citation
      })

      // 使用 REFERENCE_PROMPT 格式化引用
      const referenceContent = `\`\`\`json\n${JSON.stringify(citationData, null, 2)}\n\`\`\``
      const fullInstructions = REFERENCE_PROMPT.replace(
        '{question}',
        "Based on the Tavily search results, please answer the user's question with proper citations."
      ).replace('{references}', referenceContent)

      return {
        type: 'content',
        value: [
          {
            type: 'text',
            text: 'Tavily AI Search: AI-powered with direct answers, full content extraction, and optional image results.'
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

export type TavilySearchToolOutput = InferToolOutput<ReturnType<typeof tavilySearchTool>>
export type TavilySearchToolInput = InferToolInput<ReturnType<typeof tavilySearchTool>>
