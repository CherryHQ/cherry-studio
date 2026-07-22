import { defineProvider } from './types'

export default defineProvider({
  id: 'tencent-cloud-ti',
  name: 'Tencent Cloud TI',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.lkeap.cloud.tencent.com',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
          auto: {
            operations: [
              { target: 'enable_thinking', value: { source: 'literal', value: true } },
              { target: 'thinking_budget', value: { source: 'budget' } }
            ],
            budget: { missing: { type: 'omit-value' } }
          },
          effort: {
            operations: [
              { target: 'enable_thinking', value: { source: 'literal', value: true } },
              { target: 'thinking_budget', value: { source: 'budget' } }
            ],
            budget: { missing: { type: 'omit-value' } }
          }
        }
      }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.cloud.tencent.com/lkeap/api',
      docs: 'https://cloud.tencent.com/document/product/1772',
      models: 'https://console.cloud.tencent.com/tione/v2/aimarket',
      official: 'https://cloud.tencent.com/product/ti'
    }
  }
})
