import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'
import DefaultReranker from './DefaultReranker'
import SiliconFlowReranker from './SiliconFlowReranker'

export default class RerankerFactory {
  static create(base: KnowledgeBaseParams): BaseReranker {
    if (base.rerankModelProvider === 'silicon') {
      return new SiliconFlowReranker(base)
    }
    return new DefaultReranker(base)
  }
}
