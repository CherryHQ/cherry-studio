import { AssistantMessage } from '@renderer/types'
import {
  FactRetrievalSchema,
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  MemoryUpdateSchema,
  removeCodeBlocks,
  updateMemorySystemPrompt
} from '@renderer/utils/memory-prompts'
import { MemoryConfig, MemoryItem } from '@types'

import { fetchGenerate } from './ApiService'
import MemoryService from './MemoryService'

export interface MemoryProcessorConfig {
  memoryConfig: MemoryConfig
  assistantId?: string
  userId?: string
}

export class MemoryProcessor {
  private memoryService: MemoryService

  constructor() {
    this.memoryService = MemoryService.getInstance()
  }

  /**
   * Extract facts from conversation messages
   * @param messages - Array of conversation messages
   * @param config - Memory processor configuration
   * @returns Array of extracted facts
   */
  async extractFacts(messages: AssistantMessage[], config: MemoryProcessorConfig): Promise<string[]> {
    try {
      const { memoryConfig } = config

      if (!memoryConfig.llmModel) {
        throw new Error('No LLM model configured for memory processing')
      }

      // Convert messages to string format for processing
      const parsedMessages = messages.map((msg) => `${msg.role}: ${msg.content}`).join('\n')

      // Get fact extraction prompt
      const [systemPrompt, userPrompt] = getFactRetrievalMessages(
        parsedMessages,
        memoryConfig.customFactExtractionPrompt
      )

      const responseContent = await fetchGenerate({
        prompt: systemPrompt,
        content: userPrompt,
        model: memoryConfig.llmModel
      })
      if (!responseContent || responseContent.trim() === '') {
        return []
      }

      // Parse response using Zod schema
      try {
        const parsed = FactRetrievalSchema.parse(JSON.parse(removeCodeBlocks(responseContent.trim())))
        return parsed.facts
      } catch (parseError) {
        console.error('Failed to parse fact extraction response:', parseError)
        return []
      }
    } catch (error) {
      console.error('Error extracting facts:', error)
      return []
    }
  }

  /**
   * Update memories with new facts
   * @param facts - Array of new facts to process
   * @param config - Memory processor configuration
   * @returns Array of memory operations performed
   */
  async updateMemories(
    facts: string[],
    config: MemoryProcessorConfig
  ): Promise<Array<{ action: string; [key: string]: any }>> {
    if (facts.length === 0) {
      return []
    }

    const { memoryConfig, assistantId, userId } = config

    if (!memoryConfig.llmModel) {
      throw new Error('No LLM model configured for memory processing')
    }

    // Get existing memories for the user/assistant
    const existingMemoriesResult = await this.memoryService.list({
      userId,
      agentId: assistantId,
      limit: 100
    })

    const existingMemories = existingMemoriesResult.results.map((memory) => ({
      id: memory.id,
      text: memory.memory
    }))

    // Generate update memory prompt
    const updateMemoryUserPrompt = getUpdateMemoryMessages(
      existingMemories,
      facts,
      memoryConfig.customUpdateMemoryPrompt
    )

    const responseContent = await fetchGenerate({
      prompt: updateMemorySystemPrompt,
      content: updateMemoryUserPrompt,
      model: memoryConfig.llmModel
    })
    if (!responseContent || responseContent.trim() === '') {
      return []
    }
    // Parse response using Zod schema
    let parsed: Array<{ event: string; id: string; text: string; old_memory?: string }> = []
    try {
      parsed = MemoryUpdateSchema.parse(JSON.parse(removeCodeBlocks(responseContent)))
    } catch (parseError) {
      console.error('Failed to parse memory update response:', parseError, 'responseContent: ', responseContent)
      return []
    }

    const operations: Array<{ action: string; [key: string]: any }> = []

    for (const memoryOp of parsed) {
      switch (memoryOp.event) {
        case 'ADD':
          try {
            const result = await this.memoryService.add(memoryOp.text, {
              userId,
              agentId: assistantId
            })
            operations.push({ action: 'ADD', memory: memoryOp.text, result })
          } catch (error) {
            console.error('Failed to add memory:', error)
          }
          break

        case 'UPDATE':
          try {
            // Find the memory to update
            const existingMemory = existingMemoriesResult.results.find((m) => m.id === memoryOp.id)
            if (existingMemory) {
              await this.memoryService.update(memoryOp.id, memoryOp.text, {
                userId,
                assistantId,
                oldMemory: memoryOp.old_memory
              })
              operations.push({
                action: 'UPDATE',
                id: memoryOp.id,
                oldMemory: memoryOp.old_memory,
                newMemory: memoryOp.text
              })
            }
          } catch (error) {
            console.error('Failed to update memory:', error)
          }
          break

        case 'DELETE':
          try {
            await this.memoryService.delete(memoryOp.id)
            operations.push({ action: 'DELETE', id: memoryOp.id, memory: memoryOp.text })
          } catch (error) {
            console.error('Failed to delete memory:', error)
          }
          break

        case 'NONE':
          // No action needed
          break
      }
    }

    return operations
  }

  /**
   * Process conversation and update memories
   * @param messages - Array of conversation messages
   * @param config - Memory processor configuration
   * @returns Processing results
   */
  async processConversation(messages: AssistantMessage[], config: MemoryProcessorConfig) {
    try {
      // Extract facts from conversation
      const facts = await this.extractFacts(messages, config)

      if (facts.length === 0) {
        return { facts: [], operations: [] }
      }

      // Update memories with extracted facts
      const operations = await this.updateMemories(facts, config)

      return { facts, operations }
    } catch (error) {
      console.error('Error processing conversation:', error)
      return { facts: [], operations: [] }
    }
  }

  /**
   * Search memories for relevant context
   * @param query - Search query
   * @param config - Memory processor configuration
   * @param limit - Maximum number of results
   * @returns Array of relevant memories
   */
  async searchRelevantMemories(query: string, config: MemoryProcessorConfig, limit: number = 5): Promise<MemoryItem[]> {
    try {
      const { assistantId, userId } = config

      const result = await this.memoryService.search(query, {
        userId,
        agentId: assistantId,
        limit
      })

      console.log(
        'Searching memories with query:',
        query,
        'for user:',
        userId,
        'and assistant:',
        assistantId,
        'result: ',
        result
      )
      return result.results
    } catch (error) {
      console.error('Error searching memories:', error)
      return []
    }
  }

  /**
   * Get memory processing configuration from store
   * @param assistantId - Optional assistant ID
   * @param userId - Optional user ID
   * @returns Memory processor configuration
   */
  static getProcessorConfig(memoryConfig: MemoryConfig, assistantId?: string, userId?: string): MemoryProcessorConfig {
    return {
      memoryConfig,
      assistantId,
      userId
    }
  }
}

export const memoryProcessor = new MemoryProcessor()
