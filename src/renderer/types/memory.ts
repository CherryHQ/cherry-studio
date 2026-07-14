import type { ApiClient, Model } from './model'

export interface MemoryConfig {
  embeddingDimensions?: number
  embeddingModel?: Model
  llmModel?: Model
  // Dynamically retrieved, not persistently stored
  embeddingApiClient?: ApiClient
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  /** Indicates whether embedding dimensions are automatically detected */
  isAutoDimensions?: boolean
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
