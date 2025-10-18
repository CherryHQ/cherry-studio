import { loggerService } from '@logger'
import { REFERENCE_PROMPT } from '@renderer/config/prompts'
import WebSearchService from '@renderer/services/WebSearchService'
import { ProviderSpecificParams, WebSearchProviderResponse } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import { z } from 'zod'

const logger = loggerService.withContext('ExaSearchTool')

/**
 * Exa 专用搜索工具 - 暴露 Exa 的高级搜索能力给 LLM
 * 支持 Neural Search、Category Filtering、Date Range 等功能
 */
export const exaSearchTool = (requestId: string) => {
  const webSearchProvider = WebSearchService.getWebSearchProvider('exa')

  if (!webSearchProvider) {
    throw new Error('Exa provider not found or not configured')
  }

  return tool({
    name: 'builtin_exa_search',
    description: `Advanced AI-powered search using Exa.ai with neural understanding and filtering capabilities.

Key Features:
- Neural Search: AI-powered semantic search that understands intent
- Search Type: Choose between neural (AI), keyword (traditional), or auto mode
- Category Filter: Focus on specific content types (company, research paper, news, etc.)
- Date Range: Filter by publication date
- Auto-prompt: Let Exa optimize your query automatically

Best for: Research, finding specific types of content, semantic search, and understanding complex queries.`,

    inputSchema: z.object({
      query: z.string().describe('The search query - be specific and clear'),
      numResults: z.number().min(1).max(20).optional().describe('Number of results to return (1-20, default: 5)'),
      type: z
        .enum(['neural', 'keyword', 'auto', 'fast'])
        .optional()
        .describe(
          'Search type: neural (embeddings-based), keyword (Google-like SERP), auto (default, intelligently combines both), or fast (streamlined versions)'
        ),
      category: z
        .string()
        .optional()
        .describe(
          'Filter by content category: company, research paper, news, github, tweet, movie, song, personal site, pdf, etc.'
        ),
      startPublishedDate: z
        .string()
        .optional()
        .describe('Start date filter based on published date in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)'),
      endPublishedDate: z
        .string()
        .optional()
        .describe('End date filter based on published date in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)'),
      startCrawlDate: z
        .string()
        .optional()
        .describe('Start date filter based on crawl date in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)'),
      endCrawlDate: z
        .string()
        .optional()
        .describe('End date filter based on crawl date in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)'),
      useAutoprompt: z.boolean().optional().describe('Let Exa optimize your query automatically (recommended: true)')
    }),

    execute: async (params, { abortSignal }) => {
      // 构建 provider 特定参数（排除 query 和 numResults，这些由系统控制）
      const providerParams: ProviderSpecificParams = {
        exa: {
          type: params.type,
          category: params.category,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
          startCrawlDate: params.startCrawlDate,
          endCrawlDate: params.endCrawlDate,
          useAutoprompt: params.useAutoprompt
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

      logger.info(`Exa search completed: ${finalResults.results.length} results for "${params.query}"`)

      return finalResults
    },

    toModelOutput: (results) => {
      let summary = 'No search results found.'
      if (results.query && results.results.length > 0) {
        summary = `Found ${results.results.length} relevant sources using Exa AI search. Use [number] format to cite specific information.`
      }

      const citationData = results.results.map((result, index) => {
        const citation: any = {
          number: index + 1,
          title: result.title,
          content: result.content,
          url: result.url
        }

        // 添加 Exa 特有的元数据
        if ('favicon' in result && result.favicon) {
          citation.favicon = result.favicon
        }
        if ('author' in result && result.author) {
          citation.author = result.author
        }
        if ('publishedDate' in result && result.publishedDate) {
          citation.publishedDate = result.publishedDate
        }
        if ('score' in result && result.score !== undefined) {
          citation.score = result.score
        }
        if ('highlights' in result && result.highlights) {
          citation.highlights = result.highlights
        }

        return citation
      })

      // 使用 REFERENCE_PROMPT 格式化引用
      const referenceContent = `\`\`\`json\n${JSON.stringify(citationData, null, 2)}\n\`\`\``
      const fullInstructions = REFERENCE_PROMPT.replace(
        '{question}',
        "Based on the Exa search results, please answer the user's question with proper citations."
      ).replace('{references}', referenceContent)

      return {
        type: 'content',
        value: [
          {
            type: 'text',
            text: 'Exa AI Search: Neural search with semantic understanding and rich metadata (author, publish date, highlights).'
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

export type ExaSearchToolOutput = InferToolOutput<ReturnType<typeof exaSearchTool>>
export type ExaSearchToolInput = InferToolInput<ReturnType<typeof exaSearchTool>>
