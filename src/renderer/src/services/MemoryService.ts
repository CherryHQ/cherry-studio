import { loggerService } from '@logger'
import type { RootState } from '@renderer/store'
import store from '@renderer/store'
import { selectCurrentUserId, selectMemoryConfig } from '@renderer/store/memory'
import {
  AddMemoryOptions,
  Assistant,
  AssistantMessage,
  MemoryHistoryItem,
  MemoryListOptions,
  MemorySearchOptions,
  MemorySearchResult
} from '@types'

import { getAssistantById } from './AssistantService'

const logger = loggerService.withContext('MemoryService')

// Main process SearchResult type (matches what the IPC actually returns)
interface SearchResult {
  memories: any[]
  count: number
  error?: string
}

/**
 * Service for managing memory operations including storing, searching, and retrieving memories
 * This service delegates all operations to the main process via IPC
 */
class MemoryService {
  private static instance: MemoryService | null = null
  private currentUserId: string = 'default-user'
  private getStateFunction: () => RootState

  constructor(getStateFunction: () => RootState = () => store.getState()) {
    this.getStateFunction = getStateFunction
    this.init()
  }

  /**
   * Initializes the memory service by updating configuration in main process
   */
  private async init(): Promise<void> {
    await this.updateConfig()
  }

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
      MemoryService.instance.updateConfig().catch((error) => {
        logger.error('Failed to initialize MemoryService:', error)
      })
    }
    return MemoryService.instance
  }

  public static reloadInstance(): void {
    MemoryService.instance = new MemoryService()
  }

  /**
   * Sets the current user context for memory operations
   * @param userId - The user ID to set as current context
   */
  public setCurrentUser(userId: string): void {
    this.currentUserId = userId
  }

  /**
   * Gets the current user context
   * @returns The current user ID
   */
  public getCurrentUser(): string {
    return this.currentUserId
  }

  /**
   * Gets the effective memory user ID for an assistant using dependency injection
   * Falls back to global currentUserId when assistant has no specific memoryUserId
   * @param assistant - The assistant object containing memoryUserId
   * @param globalUserId - The global user ID to fall back to
   * @returns The effective user ID to use for memory operations
   */
  public getEffectiveUserId(assistant: Assistant, globalUserId: string): string {
    return assistant.memoryUserId || globalUserId
  }

  /**
   * Private helper to resolve user ID for context operations
   * @param assistant - Optional assistant object to determine effective user ID
   * @returns The resolved user ID to use for memory operations
   */
  private resolveUserId(assistant?: Assistant): string {
    let globalUserId = this.currentUserId

    if (this.getStateFunction) {
      try {
        globalUserId = selectCurrentUserId(this.getStateFunction())
      } catch (error) {
        logger.warn('Failed to get state, falling back to internal currentUserId:', error as Error)
        globalUserId = this.currentUserId
      }
    }

    return assistant ? this.getEffectiveUserId(assistant, globalUserId) : globalUserId
  }

  /**
   * Lists all stored memories
   * @param config - Optional configuration for filtering memories
   * @returns Promise resolving to search results containing all memories
   */
  public async list(config?: MemoryListOptions): Promise<MemorySearchResult> {
    const configWithUser = {
      ...config,
      userId: this.currentUserId
    }

    try {
      const result: SearchResult = await window.api.memory.list(configWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to list memories:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }

  /**
   * Adds new memory entries from messages
   * @param messages - String content or array of assistant messages to store as memory
   * @param config - Configuration options for adding memory
   * @returns Promise resolving to search results of added memories
   */
  public async add(messages: string | AssistantMessage[], options: AddMemoryOptions): Promise<MemorySearchResult> {
    const optionsWithUser = {
      ...options,
      userId: this.currentUserId
    }

    try {
      const result: SearchResult = await window.api.memory.add(messages, optionsWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to add memories:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }

  /**
   * Searches stored memories based on query
   * @param query - Search query string to find relevant memories
   * @param config - Configuration options for memory search
   * @returns Promise resolving to search results matching the query
   */
  public async search(query: string, options: MemorySearchOptions): Promise<MemorySearchResult> {
    const optionsWithUser = {
      ...options,
      userId: this.currentUserId
    }

    // If agentId is provided, resolve userId from assistant's memoryUserId
    if (optionsWithUser.agentId) {
      const assistant = getAssistantById(optionsWithUser.agentId)
      if (assistant) {
        optionsWithUser.userId = assistant.memoryUserId || this.currentUserId
      }
    }

    logger.debug('Searching memories start with options', { query: query, options: optionsWithUser })

    try {
      const result: SearchResult = await window.api.memory.search(query, optionsWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to search memories:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }

  /**
   * Deletes a specific memory by ID
   * @param id - Unique identifier of the memory to delete
   * @returns Promise that resolves when deletion is complete
   */
  public async delete(id: string): Promise<void> {
    return window.api.memory.delete(id)
  }

  /**
   * Updates a specific memory by ID
   * @param id - Unique identifier of the memory to update
   * @param memory - New memory content
   * @param metadata - Optional metadata to update
   * @returns Promise that resolves when update is complete
   */
  public async update(id: string, memory: string, metadata?: Record<string, any>): Promise<void> {
    return window.api.memory.update(id, memory, metadata)
  }

  /**
   * Gets the history of changes for a specific memory
   * @param id - Unique identifier of the memory
   * @returns Promise resolving to array of history items
   */
  public async get(id: string): Promise<MemoryHistoryItem[]> {
    return window.api.memory.get(id)
  }

  /**
   * Deletes all memories for a user without deleting the user
   * @param userId - The user ID whose memories to delete
   * @returns Promise that resolves when deletion is complete
   */
  public async deleteAllMemoriesForUser(userId: string): Promise<void> {
    return window.api.memory.deleteAllMemoriesForUser(userId)
  }

  /**
   * Deletes a user and all their memories (hard delete)
   * @param userId - The user ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  public async deleteUser(userId: string): Promise<void> {
    return window.api.memory.deleteUser(userId)
  }

  /**
   * Gets the list of all users with their statistics
   * @returns Promise resolving to array of user objects with userId, memoryCount, and lastMemoryDate
   */
  public async getUsersList(): Promise<{ userId: string; memoryCount: number; lastMemoryDate: string }[]> {
    return window.api.memory.getUsersList()
  }

  /**
   * Updates the memory service configuration in the main process
   * Automatically gets current memory config and provider information from Redux store
   * @returns Promise that resolves when configuration is updated
   */
  public async updateConfig(): Promise<void> {
    try {
      if (!this.getStateFunction) {
        logger.warn('State function not available, skipping memory config update')
        return
      }

      const state = this.getStateFunction()
      const memoryConfig = selectMemoryConfig(state)
      const embedderApiClient = memoryConfig.embedderApiClient
      const llmApiClient = memoryConfig.llmApiClient

      const configWithProviders = {
        ...memoryConfig,
        embedderApiClient,
        llmApiClient
      }

      return window.api.memory.setConfig(configWithProviders)
    } catch (error) {
      logger.warn('Failed to update memory config:', error as Error)
      return
    }
  }

  // Enhanced methods with assistant context support

  /**
   * Lists stored memories with assistant context support
   * Automatically resolves the effective user ID based on assistant's memoryUserId
   * @param config - Configuration for filtering memories
   * @param assistant - Optional assistant object to determine effective user ID
   * @returns Promise resolving to search results containing filtered memories
   */
  public async listWithContext(
    config?: Omit<MemoryListOptions, 'userId'>,
    assistant?: Assistant
  ): Promise<MemorySearchResult> {
    const effectiveUserId = this.resolveUserId(assistant)

    const configWithUser = {
      ...config,
      userId: effectiveUserId
    }

    try {
      const result: SearchResult = await window.api.memory.list(configWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to list memories with context:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }

  /**
   * Adds new memory entries with assistant context support
   * Automatically resolves the effective user ID based on assistant's memoryUserId
   * @param messages - String content or array of assistant messages to store as memory
   * @param options - Configuration options for adding memory (without userId)
   * @param assistant - Optional assistant object to determine effective user ID
   * @returns Promise resolving to search results of added memories
   */
  public async addWithContext(
    messages: string | AssistantMessage[],
    options: Omit<AddMemoryOptions, 'userId'>,
    assistant?: Assistant
  ): Promise<MemorySearchResult> {
    const effectiveUserId = this.resolveUserId(assistant)

    const optionsWithUser = {
      ...options,
      userId: effectiveUserId
    }

    try {
      const result: SearchResult = await window.api.memory.add(messages, optionsWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to add memories with context:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }

  /**
   * Searches stored memories with assistant context support
   * Automatically resolves the effective user ID based on assistant's memoryUserId
   * @param query - Search query string to find relevant memories
   * @param options - Configuration options for memory search (without userId)
   * @param assistant - Optional assistant object to determine effective user ID
   * @returns Promise resolving to search results matching the query
   */
  public async searchWithContext(
    query: string,
    options: Omit<MemorySearchOptions, 'userId'>,
    assistant?: Assistant
  ): Promise<MemorySearchResult> {
    const effectiveUserId = this.resolveUserId(assistant)

    const optionsWithUser = {
      ...options,
      userId: effectiveUserId
    }

    try {
      const result: SearchResult = await window.api.memory.search(query, optionsWithUser)

      // Handle error responses from main process
      if (result.error) {
        logger.error(`Memory service error: ${result.error}`)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      logger.error('Failed to search memories with context:', error as Error)
      // Return empty result on error to prevent UI crashes
      return {
        results: [],
        relations: []
      }
    }
  }
}

export default MemoryService
