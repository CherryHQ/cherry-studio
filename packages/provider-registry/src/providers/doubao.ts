import { defineProvider } from './types'

const effortWire = {
  off: { operations: [{ target: 'reasoningEffort' as const, value: { source: 'literal' as const, value: 'none' } }] },
  auto: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: { auto: 'medium' as const }
  },
  effort: { operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }] }
}

const effortModels = [
  'doubao-seed-2-1-pro',
  'doubao-seed-2-1-turbo',
  'doubao-seed-2-0-pro',
  'doubao-seed-2-0-lite',
  'doubao-seed-2-0-mini',
  'doubao-seed-2-0-code',
  'doubao-seed-1-6',
  'doubao-seed-1-6-flash',
  'doubao-seed-1-6-vision',
  'seed-1-8'
]

export default defineProvider({
  id: 'doubao',
  name: 'doubao',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
          auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
          effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
        }
      }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.volcengine.com/experience/ark',
      docs: 'https://www.volcengine.com/docs/82379/1182403',
      models: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint',
      official: 'https://console.volcengine.com/ark/'
    }
  },
  overrides: effortModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: effortWire },
      'openai-responses': { wire: effortWire }
    }
  }))
})
