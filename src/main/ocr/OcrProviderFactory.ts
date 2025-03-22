import { KnowledgeBaseParams } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import DefaultOcrProvider from './DefaultOcrProvider'
import Doc2xOcrProvider from './Doc2xOcrProvider'

export default class OcrProviderFactory {
  static create(base: KnowledgeBaseParams): BaseOcrProvider {
    if (base.ocrProvider?.id === 'doc2x') {
      return new Doc2xOcrProvider(base)
    }
    return new DefaultOcrProvider(base)
  }
}
