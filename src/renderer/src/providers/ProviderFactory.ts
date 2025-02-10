import { Provider } from '@renderer/types'

import AnthropicProvider from './AnthropicProvider'
import BaseProvider from './BaseProvider'
import GeminiProvider from './GeminiProvider'
import OpenAIProvider from './OpenAIProvider'

export default class ProviderFactory {
  static create(provider: Provider): BaseProvider {
    switch (provider.type) {
      case 'anthropic':
        return new AnthropicProvider(provider)
      case 'gemini':
        return new GeminiProvider(provider)
      default:
        return new OpenAIProvider(provider)
    }
  }
}

export function isOpenAIProvider(provider: Provider) {
  return !['anthropic', 'gemini'].includes(provider.type)
}
