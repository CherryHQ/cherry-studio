/**
 * Renderer-side memory service — thin typed wrapper around window.api.memory IPC.
 * All heavy logic lives in the main-process MemoryService.
 */

import type {
  AddMemoryOptions,
  MemoryDeleteAllOptions,
  MemoryItem,
  MemoryListOptions,
  MemoryProviderCapabilities,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryUser,
  ReflectOptions,
  ReflectResult
} from '@shared/memory'

export const memoryService = {
  capabilities(): Promise<MemoryProviderCapabilities> {
    return window.api.memory.capabilities()
  },

  healthCheck(): Promise<boolean> {
    return window.api.memory.healthCheck()
  },

  add(content: string | string[], options?: AddMemoryOptions): Promise<MemoryItem[]> {
    return window.api.memory.add(content, options)
  },

  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult> {
    return window.api.memory.search(query, options)
  },

  reflect(query: string, options?: Partial<ReflectOptions>): Promise<ReflectResult> {
    return window.api.memory.reflect(query, options)
  },

  list(options?: MemoryListOptions): Promise<MemoryItem[]> {
    return window.api.memory.list(options)
  },

  get(id: string): Promise<MemoryItem | null> {
    return window.api.memory.get(id)
  },

  update(id: string, memory: string, metadata?: Record<string, unknown>): Promise<MemoryItem> {
    return window.api.memory.update(id, memory, metadata)
  },

  delete(id: string): Promise<void> {
    return window.api.memory.delete(id)
  },

  deleteAll(options?: MemoryDeleteAllOptions): Promise<void> {
    return window.api.memory.deleteAll(options)
  },

  listUsers(): Promise<MemoryUser[]> {
    return window.api.memory.listUsers()
  }
}
