import { webSearchService } from '@renderer/services/WebSearchService'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import { REFERENCE_PROMPT } from '@shared/config/prompts'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

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
  requestId: string,
  prefillKeywords = true
) => {
  const webSearchProvider = webSearchService.getWebSearchProvider(webSearchProviderId)

  const preparedQueriesSection = prefillKeywords
    ? `\n\nThis tool has been configured with search parameters based on the conversation context:\n- Prepared queries: ${extractedKeywords.question.map((q) => `"${q}"`).join(', ')}${
        extractedKeywords.links?.length ? `\n- Relevant URLs: ${extractedKeywords.links.join(', ')}` : ''
      }\n\nYou can use this tool as-is to search with the prepared queries, or provide additionalContext to refine or replace the search terms.`
    : '\n\nProvide additionalContext with your search terms to query the web.'

  return tool({
    description: `Web search tool for finding current information, news, and real-time data from the internet.${preparedQueriesSection}`,

    inputSchema: z.object({
      additionalContext: z
        .string()
        .optional()
        .describe(
          prefillKeywords
            ? 'Optional additional context, keywords, or specific focus to enhance the search'
            : 'Search query or keywords to search the web'
        )
    }),

    execute: async ({ additionalContext }) => {
      const emptyResult: WebSearchProviderResponse = { query: '', results: [] }

      if (!webSearchProvider) {
        throw new Error(
          `Web search provider "${webSearchProviderId}" not found. Check that the provider is configured correctly.`
        )
      }

      if (!prefillKeywords) {
        // Model-driven mode: additionalContext is optional in the schema; no query means no search.
        const query = additionalContext?.trim()
        if (!query) {
          return emptyResult
        }
        const extractResults: ExtractResults = { websearch: { question: [query] } }
        return webSearchService.processWebsearch(webSearchProvider, extractResults, requestId)
      }

      // Pre-extraction mode: fall back to extracted keywords when model adds no extra context.
      const finalQueries = additionalContext?.trim() ? [additionalContext.trim()] : [...extractedKeywords.question]

      // 检查是否需要搜索
      if (finalQueries[0] === 'not_needed' || !finalQueries.some((q) => q.trim().length > 0)) {
        return emptyResult
      }

      // 构建 ExtractResults 结构用于 processWebsearch
      const extractResults: ExtractResults = {
        websearch: {
          question: finalQueries,
          links: extractedKeywords.links
        }
      }
      return webSearchService.processWebsearch(webSearchProvider, extractResults, requestId)
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

      // 🔑 返回引用友好的格式，复用 REFERENCE_PROMPT 逻辑
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

// export const webSearchToolWithExtraction = (
//   webSearchProviderId: WebSearchProvider['id'],
//   requestId: string,
//   assistant: Assistant
// ) => {
//   const webSearchService = WebSearchService.getInstance(webSearchProviderId)

//   return tool({
//     name: 'web_search_with_extraction',
//     description: 'Search the web for information with automatic keyword extraction from user messages',
//     inputSchema: z.object({
//       userMessage: z.object({
//         content: z.string().describe('The main content of the message'),
//         role: z.enum(['user', 'assistant', 'system']).describe('Message role')
//       }),
//       lastAnswer: z.object({
//         content: z.string().describe('The main content of the message'),
//         role: z.enum(['user', 'assistant', 'system']).describe('Message role')
//       })
//     }),
//     outputSchema: z.object({
//       extractedKeywords: z.object({
//         question: z.array(z.string()),
//         links: z.array(z.string()).optional()
//       }),
//       searchResults: z.array(
//         z.object({
//           query: z.string(),
//           results: WebSearchProviderResult
//         })
//       )
//     }),
//     execute: async ({ userMessage, lastAnswer }) => {
//       const lastUserMessage: Message = {
//         id: requestId,
//         role: userMessage.role,
//         assistantId: assistant.id,
//         topicId: 'temp',
//         createdAt: new Date().toISOString(),
//         status: UserMessageStatus.SUCCESS,
//         blocks: []
//       }

//       const lastAnswerMessage: Message | undefined = lastAnswer
//         ? {
//             id: requestId + '_answer',
//             role: lastAnswer.role,
//             assistantId: assistant.id,
//             topicId: 'temp',
//             createdAt: new Date().toISOString(),
//             status: UserMessageStatus.SUCCESS,
//             blocks: []
//           }
//         : undefined

//       const extractResults = await extractSearchKeywords(lastUserMessage, assistant, {
//         shouldWebSearch: true,
//         shouldKnowledgeSearch: false,
//         lastAnswer: lastAnswerMessage
//       })

//       if (!extractResults?.websearch || extractResults.websearch.question[0] === 'not_needed') {
//         return 'No search needed or extraction failed'
//       }

//       const searchQueries = extractResults.websearch.question
//       const searchResults: Array<{ query: string; results: any }> = []

//       for (const query of searchQueries) {
//         // 构建单个查询的ExtractResults结构
//         const queryExtractResults: ExtractResults = {
//           websearch: {
//             question: [query],
//             links: extractResults.websearch.links
//           }
//         }
//         const response = await webSearchService.processWebsearch(queryExtractResults, requestId)
//         searchResults.push({
//           query,
//           results: response
//         })
//       }

//       return { extractedKeywords: extractResults.websearch, searchResults }
//     }
//   })
// }

// export type WebSearchToolWithExtractionOutput = InferToolOutput<ReturnType<typeof webSearchToolWithExtraction>>

export type WebSearchToolOutput = InferToolOutput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
export type WebSearchToolInput = InferToolInput<ReturnType<typeof webSearchToolWithPreExtractedKeywords>>
