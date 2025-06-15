import { Model } from '@types'

export interface MemoryConfig {
  embedderModel?: Model
  embedderDimensions?: number
  llmModel?: Model
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
}

export interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}

export interface SearchResult {
  results: MemoryItem[]
  relations?: any[]
}

export interface Entity {
  userId?: string
  agentId?: string
  runId?: string
}

export interface SearchFilters {
  userId?: string
  agentId?: string
  runId?: string
  [key: string]: any
}

export interface AddMemoryOptions extends Entity {
  metadata?: Record<string, any>
  filters?: SearchFilters
  infer?: boolean
}

export interface SearchMemoryOptions extends Entity {
  limit?: number
  filters?: SearchFilters
}

export interface GetAllMemoryOptions extends Entity {
  limit?: number
}

export interface DeleteAllMemoryOptions extends Entity {}
