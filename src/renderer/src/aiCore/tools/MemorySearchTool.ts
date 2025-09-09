import store from '@renderer/store'
import { selectCurrentUserId, selectGlobalMemoryEnabled, selectMemoryConfig } from '@renderer/store/memory'
import type { Assistant } from '@renderer/types'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import { z } from 'zod'

import { MemoryProcessor } from '../../services/MemoryProcessor'

/**
 * 🧠 基础记忆搜索工具
 * AI 可以主动调用的简单记忆搜索
 */
export const memorySearchTool = () => {
  return tool({
    name: 'builtin_memory_search',
    description: 'Search through conversation memories and stored facts for relevant context',
    inputSchema: z.object({
      query: z.string().describe('Search query to find relevant memories'),
      limit: z.number().min(1).max(20).default(5).describe('Maximum number of memories to return')
    }),
    execute: async ({ query, limit = 5 }) => {
      try {
        const globalMemoryEnabled = selectGlobalMemoryEnabled(store.getState())
        if (!globalMemoryEnabled) {
          return []
        }

        const memoryConfig = selectMemoryConfig(store.getState())
        if (!memoryConfig.llmApiClient || !memoryConfig.embedderApiClient) {
          return []
        }

        const currentUserId = selectCurrentUserId(store.getState())
        const processorConfig = MemoryProcessor.getProcessorConfig(memoryConfig, 'default', currentUserId)

        const memoryProcessor = new MemoryProcessor()
        const relevantMemories = await memoryProcessor.searchRelevantMemories(query, processorConfig, limit)

        if (relevantMemories?.length > 0) {
          return relevantMemories
        }
        return []
      } catch (error) {
        return []
      }
    }
  })
}

// 方案4: 为第二个工具也使用类型断言
type MessageRole = 'user' | 'assistant' | 'system'
type MessageType = {
  content: string
  role: MessageRole
}
type MemorySearchWithExtractionInput = {
  userMessage: MessageType
  lastAnswer?: MessageType
}

/**
 * 🧠 智能记忆搜索工具（带上下文提取）
 * 从用户消息和对话历史中自动提取关键词进行记忆搜索
 */
export const memorySearchToolWithExtraction = (assistant: Assistant) => {
  return tool({
    name: 'memory_search_with_extraction',
    description: 'Search memories with automatic keyword extraction from conversation context',
    inputSchema: z.object({
      userMessage: z.object({
        content: z.string().describe('The main content of the user message'),
        role: z.enum(['user', 'assistant', 'system']).describe('Message role')
      }),
      lastAnswer: z
        .object({
          content: z.string().describe('The main content of the last assistant response'),
          role: z.enum(['user', 'assistant', 'system']).describe('Message role')
        })
        .optional()
    }) satisfies z.ZodSchema<MemorySearchWithExtractionInput>,
    execute: async ({ userMessage }) => {
      try {
        const globalMemoryEnabled = selectGlobalMemoryEnabled(store.getState())
        if (!globalMemoryEnabled || !assistant.enableMemory) {
          return {
            extractedKeywords: 'Memory search disabled',
            searchResults: []
          }
        }

        const memoryConfig = selectMemoryConfig(store.getState())
        if (!memoryConfig.llmApiClient || !memoryConfig.embedderApiClient) {
          return {
            extractedKeywords: 'Memory models not configured',
            searchResults: []
          }
        }

        // 🔍 使用用户消息内容作为搜索关键词
        const content = userMessage.content

        if (!content) {
          return {
            extractedKeywords: 'No content to search',
            searchResults: []
          }
        }

        const currentUserId = selectCurrentUserId(store.getState())
        const processorConfig = MemoryProcessor.getProcessorConfig(memoryConfig, assistant.id, currentUserId)

        const memoryProcessor = new MemoryProcessor()
        const relevantMemories = await memoryProcessor.searchRelevantMemories(
          content,
          processorConfig,
          5 // Limit to top 5 most relevant memories
        )

        if (relevantMemories?.length > 0) {
          return {
            extractedKeywords: content,
            searchResults: relevantMemories
          }
        }

        return {
          extractedKeywords: content,
          searchResults: []
        }
      } catch (error) {
        return {
          extractedKeywords: 'Search failed',
          searchResults: []
        }
      }
    }
  })
}
export type MemorySearchToolInput = InferToolInput<ReturnType<typeof memorySearchTool>>
export type MemorySearchToolOutput = InferToolOutput<ReturnType<typeof memorySearchTool>>
export type MemorySearchToolWithExtractionOutput = InferToolOutput<ReturnType<typeof memorySearchToolWithExtraction>>
