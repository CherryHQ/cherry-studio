import store from '@renderer/store'
import { selectMemoryConfig } from '@renderer/store/memory'
import {
  AddMemoryOptions,
  AssistantMessage,
  MemoryHistoryItem,
  MemoryListOptions,
  MemorySearchOptions,
  MemorySearchResult
} from '@types'

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

  constructor() {
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
        console.error('Failed to initialize MemoryService:', error)
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
        console.error('Memory service error:', result.error)
        throw new Error(result.error)
      }

      // Convert SearchResult to MemorySearchResult for consistency
      return {
        results: result.memories || [],
        relations: []
      }
    } catch (error) {
      console.error('Failed to list memories:', error)
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
    options.userId = this.currentUserId
    const result: SearchResult = await window.api.memory.add(messages, options)
    // Convert SearchResult to MemorySearchResult for consistency
    return {
      results: result.memories,
      relations: []
    }
  }

  /**
   * Searches stored memories based on query
   * @param query - Search query string to find relevant memories
   * @param config - Configuration options for memory search
   * @returns Promise resolving to search results matching the query
   */
  public async search(query: string, options: MemorySearchOptions): Promise<MemorySearchResult> {
    options.userId = this.currentUserId
    const result: SearchResult = await window.api.memory.search(query, options)
    // Convert SearchResult to MemorySearchResult for consistency
    return {
      results: result.memories,
      relations: []
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
      if (!store || !store.getState) {
        console.warn('Store not available, skipping memory config update')
        return
      }

      const memoryConfig = selectMemoryConfig(store.getState())
      const embedderApiClient = memoryConfig.embedderApiClient
      const llmApiClient = memoryConfig.llmApiClient

      const configWithProviders = {
        ...memoryConfig,
        embedderApiClient,
        llmApiClient
      }

      return window.api.memory.setConfig(configWithProviders)
    } catch (error) {
      console.warn('Failed to update memory config:', error)
      return
    }
  }
}

export default MemoryService
