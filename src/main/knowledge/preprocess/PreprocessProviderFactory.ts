import { PreprocessProvider } from '@types'

import BasePreprocessProvider from './BasePreprocessProvider'
import DefaultPreprocessProvider from './DefaultPreprocessProvider'
import Doc2xPreprocessProvider from './Doc2xPreprocessProvider'
import MineruPreprocessProvider from './MineruPreprocessProvider'
import MistralPreprocessProvider from './MistralPreprocessProvider'
export default class PreprocessProviderFactory {
  static create(provider: PreprocessProvider, userId?: string): BasePreprocessProvider {
    switch (provider.id) {
      case 'doc2x':
        return new Doc2xPreprocessProvider(provider)
      case 'mistral':
        return new MistralPreprocessProvider(provider)
      case 'mineru':
        return new MineruPreprocessProvider(provider, userId)
      default:
        return new DefaultPreprocessProvider(provider)
    }
  }
}
