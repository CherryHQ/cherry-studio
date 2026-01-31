import type { WebSearchProviderResult } from '@renderer/types'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

export class NullCompressionStrategy implements ICompressionStrategy {
  readonly name = 'none'

  async compress(results: WebSearchProviderResult[], _context: CompressionContext): Promise<WebSearchProviderResult[]> {
    void _context

    return results
  }
}
