import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const thinkingWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] },
  effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
}

export default defineProvider({
  id: 'longcat',
  name: 'LongCat',
  defaultChatEndpoint: 'openai-chat-completions',
  modelListSource: 'registry',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.longcat.chat/openai',
      reasoningFormat: { type: 'openai-chat', wire: thinkingWire }
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.longcat.chat/anthropic',
      reasoningFormat: { type: 'anthropic', wire: thinkingWire }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://longcat.chat/platform/api_keys',
      docs: 'https://longcat.chat/platform/docs/zh/',
      models: 'https://longcat.chat/platform/docs/zh/APIDocs.html',
      official: 'https://longcat.chat'
    }
  },
  overrides: [
    {
      modelId: 'longcat-2-0',
      apiModelId: 'LongCat-2.0',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.3 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.006 },
        output: { currency: 'USD', perMillionTokens: 1.2 }
      }
    }
  ]
})
