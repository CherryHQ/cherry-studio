import { Provider } from '@renderer/types'

import AnthropicProvider from './AnthropicProvider'
import BaseProvider from './BaseProvider'
import BedrockProvider from './bedrock/BedrockProvider'
import GeminiProvider from './GeminiProvider'
import OpenAIProvider from './OpenAIProvider'

export default class ProviderFactory {
  static create(provider: Provider): BaseProvider {
    switch (provider.type) {
      case 'anthropic':
        return new AnthropicProvider(provider)
      case 'gemini':
        return new GeminiProvider(provider)
      case 'bedrock':
        return new BedrockProvider(provider)
      default:
        return new OpenAIProvider(provider)
    }
  }
}

export function isOpenAIProvider(provider: Provider) {
  return !['anthropic', 'gemini', 'bedrock'].includes(provider.type)
}
