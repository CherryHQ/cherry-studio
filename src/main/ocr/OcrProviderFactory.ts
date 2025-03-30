import { OcrProvider } from '@types'

import BaseOcrProvider from './BaseOcrProvider'
import DefaultOcrProvider from './DefaultOcrProvider'
import Doc2xOcrProvider from './Doc2xOcrProvider'
import MacSysOcrProvider from './MacSysOcrProvider'
import MistralOcrProvider from './MistralOcrProvider'
export default class OcrProviderFactory {
  static create(provider: OcrProvider): BaseOcrProvider {
    switch (provider.id) {
      case 'doc2x':
        return new Doc2xOcrProvider(provider)
      case 'mistral':
        return new MistralOcrProvider(provider)
      case 'system':
        return new MacSysOcrProvider(provider)
      default:
        return new DefaultOcrProvider(provider)
    }
  }
}
