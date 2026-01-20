import type { WebSearchProviderResult } from '@renderer/types'

export interface CompressionContext {
  questions: string[]
  requestId: string
}

export interface ICompressionStrategy {
  readonly name: string
  compress(results: WebSearchProviderResult[], context: CompressionContext): Promise<WebSearchProviderResult[]>
}
