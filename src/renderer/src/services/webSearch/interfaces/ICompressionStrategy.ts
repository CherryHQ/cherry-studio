import type { WebSearchProviderResult } from '@renderer/types'
import type { WebSearchCompressionMethod } from '@shared/data/preference/preferenceTypes'

export interface CompressionContext {
  questions: string[]
  requestId: string
}

export interface ICompressionStrategy {
  readonly name: WebSearchCompressionMethod
  compress(results: WebSearchProviderResult[], context: CompressionContext): Promise<WebSearchProviderResult[]>
}
