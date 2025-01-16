import type { GroundingMetadata } from '@google/generative-ai'
import type { Assistant, Metrics } from '@renderer/types'

interface ChunkCallbackData {
  text?: string
  usage?: OpenAI.Completions.CompletionUsage
  metrics?: Metrics
  search?: GroundingMetadata
}

interface CompletionsParams {
  messages: Message[]
  assistant: Assistant
  onChunk: ({ text, usage, metrics, search }: ChunkCallbackData) => void
  onFilterMessages: (messages: Message[]) => void
}
