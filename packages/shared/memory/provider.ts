/**
 * MemoryProvider interface — the contract every memory provider must implement.
 *
 * Providers are instantiated by MemoryProviderRegistry in the main process.
 * The renderer never calls providers directly; it goes through IPC → MemoryService.
 *
 * DTOs are mem0-style (see types.ts). Each provider translates internally.
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
} from './types'

export interface MemoryProvider {
  /** Stable identifier matching MemoryProviderId */
  readonly id: string

  /** Static capabilities descriptor — queried once per provider instance */
  readonly capabilities: MemoryProviderCapabilities

  /**
   * Perform any async initialisation (open DB, validate connection, etc.).
   * Called by MemoryService during provider activation.
   */
  init(): Promise<void>

  /**
   * Persist a new memory (or a batch of conversation turns).
   * For providers with serverSideExtraction = true, `content` may be raw
   * conversation text — the server extracts and stores facts.
   * For LibSql the caller (MemoryProcessor) has already extracted facts.
   */
  add(content: string | string[], options?: AddMemoryOptions): Promise<MemoryItem[]>

  /**
   * Semantic / hybrid search over stored memories.
   * Returns ranked MemoryItem array with optional relation metadata.
   */
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult>

  /** List all memories for the given entity scope. */
  list(options?: MemoryListOptions): Promise<MemoryItem[]>

  /** Fetch a single memory by id. */
  get(id: string): Promise<MemoryItem | null>

  /** Replace the memory text for an existing entry. */
  update(id: string, memory: string, metadata?: Record<string, unknown>): Promise<MemoryItem>

  /** Delete a single memory by id. */
  delete(id: string): Promise<void>

  /** Delete all memories matching the given entity scope. */
  deleteAll(options?: MemoryDeleteAllOptions): Promise<void>

  /**
   * Deep reflection / analysis over existing memories (optional).
   * Only providers with capabilities.supportsReflect = true implement this.
   * Called from Memory Browser UI, never injected as an LLM tool.
   */
  reflect?(options: ReflectOptions): Promise<ReflectResult>

  /** Return a list of known users/scopes that have stored memories. */
  listUsers(): Promise<MemoryUser[]>

  /**
   * Verify connectivity and configuration.
   * Returns true if the provider is reachable and correctly configured.
   */
  healthCheck(): Promise<boolean>

  /**
   * Optional teardown — close DB connections, cancel timers, etc.
   * Called by MemoryService when the provider is deactivated or replaced.
   */
  destroy?(): Promise<void>
}
