import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'
import DefaultReranker from './DefaultReranker'
import JinaReranker from './JinaReranker'
import SiliconFlowReranker from './SiliconFlowReranker'

export default class RerankerFactory {
  static create(base: KnowledgeBaseParams): BaseReranker {
    if (base.rerankModelProvider === 'silicon') {
      return new SiliconFlowReranker(base)
    } else if (base.rerankModelProvider === 'jina') {
      return new JinaReranker(base)
    }
    return new DefaultReranker(base)
  }
}
