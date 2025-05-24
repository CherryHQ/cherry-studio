import { Provider } from '@renderer/types'

import { wrapProviderWithMiddleware } from '../middleware'
import middlewareConfig from '../middleware/register'
import AihubmixProvider from './AihubmixProvider'
import AnthropicProvider from './AnthropicProvider'
import BaseProvider from './BaseProvider'
import GeminiProvider from './GeminiProvider'
import OpenAIProvider from './OpenAIProvider'
import OpenAIResponseProvider from './OpenAIResponseProvider'

export default class ProviderFactory {
  static create(provider: Provider): BaseProvider {
    let instance: BaseProvider

    if (provider.id === 'aihubmix') {
      instance = new AihubmixProvider(provider)
    } else {
      switch (provider.type) {
        case 'openai':
          instance = new OpenAIProvider(provider)
          break
        case 'openai-response':
          instance = new OpenAIResponseProvider(provider)
          break
        case 'anthropic':
          instance = new AnthropicProvider(provider)
          break
        case 'gemini':
          instance = new GeminiProvider(provider)
          break
        default:
          instance = new OpenAIProvider(provider)
      }
    }
    return wrapProviderWithMiddleware(instance, middlewareConfig)
  }
}

export function isOpenAIProvider(provider: Provider) {
  return !['anthropic', 'gemini'].includes(provider.type)
}
