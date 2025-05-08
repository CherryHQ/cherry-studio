import { Provider } from '@renderer/types'

import AihubmixProvider from './AihubmixProvider'
import AnthropicProvider from './AnthropicProvider'
import BaseProvider from './BaseProvider'
import GeminiProvider from './GeminiProvider'
import OpenAICompatibleProvider from './OpenAICompatibleProvider'
import OpenAIProvider from './OpenAIProvider'

export default class ProviderFactory {
  static create(provider: Provider): BaseProvider {
    switch (provider.type) {
      case 'openai':
        if (provider.id === 'aihubmix') {
          return new AihubmixProvider(provider)
        }
        return new OpenAIProvider(provider)
      case 'openai-compatible':
        return new OpenAICompatibleProvider(provider)
      case 'anthropic':
        return new AnthropicProvider(provider)
      case 'gemini':
        return new GeminiProvider(provider)
      default:
        return new OpenAICompatibleProvider(provider)
    }
  }
}

export function isOpenAIProvider(provider: Provider) {
  return !['anthropic', 'gemini'].includes(provider.type)
}
