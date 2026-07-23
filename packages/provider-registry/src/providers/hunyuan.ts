import { defineProvider } from './types'

export default defineProvider({
  id: 'hunyuan',
  name: 'hunyuan',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com',
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
  serverTools: [{ id: 'web-search', modelScope: 'model-dependent' }],
  metadata: {
    website: {
      apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
      docs: 'https://cloud.tencent.com/document/product/1729/111007',
      models: 'https://cloud.tencent.com/document/product/1729/104753',
      official: 'https://cloud.tencent.com/product/hunyuan'
    }
  }
})
