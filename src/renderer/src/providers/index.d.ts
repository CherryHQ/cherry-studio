import type { Assistant, Metrics } from '@renderer/types'

interface ChunkCallbackData {
  text?: string
  usage?: OpenAI.Completions.CompletionUsage
  metrics?: Metrics
}

interface CompletionsParams {
  messages: Message[]
  assistant: Assistant
  onChunk: ({ text, usage }: ChunkCallbackData) => void
  onFilterMessages: (messages: Message[]) => void
}
