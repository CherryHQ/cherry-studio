import { AssistantMessage } from '@renderer/types'
import { AddMemoryOptions, GetAllMemoryOptions, SearchMemoryOptions, SearchResult } from '@renderer/types/memory'

/**
 * Service for managing memory operations including storing, searching, and retrieving memories
 * This service delegates all operations to the main process via IPC
 */
class MemoryService {
  private static instance: MemoryService | null = null

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  public static reloadInstance(): void {
    MemoryService.instance = new MemoryService()
  }

  /**
   * Lists all stored memories
   * @param config - Optional configuration for filtering memories
   * @returns Promise resolving to search results containing all memories
   */
  public async list(config?: GetAllMemoryOptions): Promise<SearchResult> {
    return window.api.memory.list(config)
  }

  /**
   * Adds new memory entries from messages
   * @param messages - String content or array of assistant messages to store as memory
   * @param config - Configuration options for adding memory
   * @returns Promise resolving to search results of added memories
   */
  public async add(messages: string | AssistantMessage[], config: AddMemoryOptions): Promise<SearchResult> {
    return window.api.memory.add(messages, config)
  }

  /**
   * Searches stored memories based on query
   * @param query - Search query string to find relevant memories
   * @param config - Configuration options for memory search
   * @returns Promise resolving to search results matching the query
   */
  public async search(query: string, config: SearchMemoryOptions): Promise<SearchResult> {
    return window.api.memory.search(query, config)
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
   * @param memoryId - Unique identifier of the memory
   * @returns Promise resolving to array of history items
   */
  public async getHistory(memoryId: string): Promise<any[]> {
    return window.api.memory.getHistory(memoryId)
  }

  /**
   * Resets all memories (deletes everything)
   * @returns Promise that resolves when reset is complete
   */
  public async reset(): Promise<void> {
    return window.api.memory.reset()
  }
}

export default MemoryService
