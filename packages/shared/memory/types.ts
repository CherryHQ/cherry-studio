/**
 * Shared memory types — single source of truth for all memory-related
 * data shapes, shared between main process and renderer.
 *
 * DTOs are intentionally kept mem0-style (id / memory / score / metadata)
 * so the renderer and AI SDK tool surface is provider-agnostic.
 * Each provider translates to/from its own wire format internally.
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

export type MemoryProviderId = 'off' | 'libsql' | 'hindsight'

export type BankStrategy = 'global' | 'per_user' | 'per_assistant' | 'per_topic'

// ---------------------------------------------------------------------------
// Provider capabilities (advertised by each provider at runtime)
// ---------------------------------------------------------------------------

export interface MemoryProviderCapabilities {
  /** Provider supports the reflect() operation */
  supportsReflect: boolean
  /** Provider supports Hindsight-style mental models */
  supportsMentalModels: boolean
  /** Provider manages memory in named banks */
  supportsBanks: boolean
  /** Provider does server-side fact extraction (skip local MemoryProcessor) */
  serverSideExtraction: boolean
}

// ---------------------------------------------------------------------------
// Core DTOs (mem0-style, provider-agnostic)
// ---------------------------------------------------------------------------

export interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, unknown>
}

export interface MemorySearchResult {
  results: MemoryItem[]
  relations?: unknown[]
}

export interface MemoryEntity {
  userId?: string
  agentId?: string
  runId?: string
  /** Topic / conversation id — used when bank_strategy = 'per_topic' */
  topicId?: string
}

export interface MemorySearchFilters {
  userId?: string
  agentId?: string
  runId?: string
  topicId?: string
  [key: string]: unknown
}

export interface AddMemoryOptions extends MemoryEntity {
  metadata?: Record<string, unknown>
  filters?: MemorySearchFilters
  /** Whether to run inference/extraction on the content (provider-dependent) */
  infer?: boolean
  /** ISO-8601 timestamp to associate with this memory */
  timestamp?: string
}

export interface MemorySearchOptions extends MemoryEntity {
  limit?: number
  filters?: MemorySearchFilters
}

export interface MemoryListOptions extends MemoryEntity {
  limit?: number
  offset?: number
}

export interface MemoryDeleteAllOptions extends MemoryEntity {}

export interface MemoryHistoryItem {
  id: number
  memoryId: string
  previousValue?: string
  newValue: string
  action: 'ADD' | 'UPDATE' | 'DELETE'
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

// ---------------------------------------------------------------------------
// Reflect (Hindsight-specific, exposed only in Memory Browser UI)
// ---------------------------------------------------------------------------

export interface ReflectOptions extends MemoryEntity {
  /** The question or analytical prompt to reflect on */
  query: string
  /** Max tokens for the generated reflection */
  maxTokens?: number
}

export interface ReflectResult {
  /** The synthesised reflection text */
  content: string
  /** Provider-specific structured data (e.g. Hindsight mental model details) */
  structured?: unknown
}

// ---------------------------------------------------------------------------
// User listing
// ---------------------------------------------------------------------------

export interface MemoryUser {
  userId: string
  memoryCount?: number
}
