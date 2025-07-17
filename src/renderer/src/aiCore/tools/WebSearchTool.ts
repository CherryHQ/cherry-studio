import { extractSearchKeywords } from '@renderer/aiCore/transformParameters'
import WebSearchService from '@renderer/services/WebSearchService'
import { Assistant, Message, WebSearchProvider } from '@renderer/types'
import { UserMessageStatus } from '@renderer/types/newMessage'
import { ExtractResults } from '@renderer/utils/extract'
import * as aiSdk from 'ai'

import { AiSdkTool, ToolCallResult } from './types'

export const webSearchTool = (webSearchProviderId: WebSearchProvider['id']): AiSdkTool => {
  const webSearchService = WebSearchService.getInstance(webSearchProviderId)
  return {
    name: 'builtin_web_search',
    description: 'Search the web for information',
    inputSchema: aiSdk.jsonSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query to search for' }
      },
      required: ['query']
    }),
    execute: async ({ query }): Promise<ToolCallResult> => {
      try {
        console.log('webSearchTool', query)
        const response = await webSearchService.search(query)
        console.log('webSearchTool response', response)
        return {
          success: true,
          data: response
        }
      } catch (error) {
        return {
          success: false,
          data: error
        }
      }
    }
  }
}

export const webSearchToolWithExtraction = (
  webSearchProviderId: WebSearchProvider['id'],
  requestId: string,
  assistant: Assistant
): AiSdkTool => {
  const webSearchService = WebSearchService.getInstance(webSearchProviderId)

  return {
    name: 'web_search_with_extraction',
    description: 'Search the web for information with automatic keyword extraction from user messages',
    inputSchema: aiSdk.jsonSchema({
      type: 'object',
      properties: {
        userMessage: {
          type: 'object',
          description: 'The user message to extract keywords from',
          properties: {
            content: { type: 'string', description: 'The main content of the message' },
            role: { type: 'string', description: 'Message role (user/assistant/system)' }
          },
          required: ['content', 'role']
        },
        lastAnswer: {
          type: 'object',
          description: 'Optional last assistant response for context',
          properties: {
            content: { type: 'string', description: 'The main content of the message' },
            role: { type: 'string', description: 'Message role (user/assistant/system)' }
          },
          required: ['content', 'role']
        }
      },
      required: ['userMessage']
    }),
    execute: async ({ userMessage, lastAnswer }): Promise<ToolCallResult> => {
      try {
        const lastUserMessage: Message = {
          id: requestId,
          role: userMessage.role as 'user' | 'assistant' | 'system',
          assistantId: assistant.id,
          topicId: 'temp',
          createdAt: new Date().toISOString(),
          status: UserMessageStatus.SUCCESS,
          blocks: []
        }

        const lastAnswerMessage: Message | undefined = lastAnswer
          ? {
              id: requestId + '_answer',
              role: lastAnswer.role as 'user' | 'assistant' | 'system',
              assistantId: assistant.id,
              topicId: 'temp',
              createdAt: new Date().toISOString(),
              status: UserMessageStatus.SUCCESS,
              blocks: []
            }
          : undefined

        const extractResults = await extractSearchKeywords(lastUserMessage, assistant, {
          shouldWebSearch: true,
          shouldKnowledgeSearch: false,
          lastAnswer: lastAnswerMessage
        })

        if (!extractResults?.websearch || extractResults.websearch.question[0] === 'not_needed') {
          return {
            success: false,
            data: 'No search needed or extraction failed'
          }
        }

        const searchQueries = extractResults.websearch.question
        const searchResults: Array<{ query: string; results: any }> = []

        for (const query of searchQueries) {
          // 构建单个查询的ExtractResults结构
          const queryExtractResults: ExtractResults = {
            websearch: {
              question: [query],
              links: extractResults.websearch.links
            }
          }
          const response = await webSearchService.processWebsearch(queryExtractResults, requestId)
          searchResults.push({
            query,
            results: response
          })
        }

        return {
          success: true,
          data: {
            extractedKeywords: extractResults.websearch,
            searchResults
          }
        }
      } catch (error) {
        return {
          success: false,
          data: error
        }
      }
    }
  }
}
