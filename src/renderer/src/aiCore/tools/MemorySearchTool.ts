import store from '@renderer/store'
import { selectCurrentUserId, selectGlobalMemoryEnabled, selectMemoryConfig } from '@renderer/store/memory'
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
    }
  })
}

export type MemorySearchToolInput = InferToolInput<ReturnType<typeof memorySearchTool>>
export type MemorySearchToolOutput = InferToolOutput<ReturnType<typeof memorySearchTool>>
