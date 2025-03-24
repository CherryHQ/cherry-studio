import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'

export default class DefaultReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  async rerank(): Promise<ExtractChunkData[]> {
    throw new Error('Method not implemented.')
  }
}
