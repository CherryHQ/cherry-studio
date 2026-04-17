/**
 * MemorySearchTool — AI SDK tool that lets the LLM search stored memories
 * during reasoning. The tool is injected into the request by
 * searchOrchestrationPlugin when:
 *   - feature.memory.enabled is true
 *   - feature.memory.provider !== 'off'
 *   - assistant.enableMemory is true
 *
 * Reflects is intentionally NOT exposed here — it is only available from the
 * Memory Browser UI to avoid unbounded LLM-triggered analysis calls.
 */

import { loggerService } from '@logger'
import { memoryService } from '@renderer/services/MemoryService'
import type { MemoryItem } from '@shared/memory'
import { tool } from 'ai'
import * as z from 'zod'

const logger = loggerService.withContext('MemorySearchTool')

export const memorySearchTool = (userId: string, agentId?: string, topicId?: string) => {
  return tool({
    description: `Search through stored conversation memories and personal facts for context relevant to the current question.
Use this when the user asks about past conversations, personal preferences, prior decisions, or when context from previous sessions would improve your response.
Do not use this for general knowledge questions — only for recalling what you or the user have discussed or decided previously.`,

    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe('The specific question or topic to search memories for. Be concise and specific.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe('Maximum number of memories to retrieve (default 5)')
    }),

    execute: async ({ query, limit }) => {
      try {
        const result = await memoryService.search(query, {
          userId,
          agentId,
          topicId,
          limit: limit ?? 5
        })
        return result.results.map((item: MemoryItem) => ({
          id: item.id,
          content: item.memory,
          score: item.score,
          createdAt: item.createdAt,
          metadata: item.metadata
        }))
      } catch (error) {
        logger.warn('Memory search failed (non-blocking)', error as Error)
        return []
      }
    },

    toModelOutput: ({ output: memories }) => {
      if (!memories || memories.length === 0) {
        return {
          type: 'content',
          value: [{ type: 'text', text: 'No relevant memories found for this query.' }]
        }
      }

      const memoryText = memories
        .map((m, i) => `[Memory ${i + 1}] ${m.content}${m.createdAt ? ` (${m.createdAt})` : ''}`)
        .join('\n\n')

      return {
        type: 'content',
        value: [
          {
            type: 'text',
            text: `Found ${memories.length} relevant memories:\n\n${memoryText}\n\nUse this context to inform your response, but do not quote memories verbatim unless directly relevant.`
          }
        ]
      }
    }
  })
}

export default memorySearchTool
