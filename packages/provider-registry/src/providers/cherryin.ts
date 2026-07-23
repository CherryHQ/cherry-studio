import { defineProvider } from './types'

const deepSeekThinkingWire = {
  off: {
    operations: [
      { target: 'extra_body.thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }
    ]
  },
  auto: {
    operations: [
      { target: 'extra_body.thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } }
    ]
  },
  effort: {
    operations: [
      { target: 'extra_body.thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } }
    ]
  }
}

const deepSeekModels = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3-1', 'deepseek-v3-2']

export default defineProvider({
  id: 'cherryin',
  name: 'CherryIN',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'google-generate-content': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'openai-chat-completions': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  serverTools: [
    { id: 'web-search', modelScope: 'model-dependent' },
    { id: 'url-context', modelScope: 'model-dependent' }
  ],
  metadata: {
    website: {
      apiKey: 'https://open.cherryin.ai/console/token',
      docs: 'https://open.cherryin.ai',
      models: 'https://open.cherryin.ai/pricing',
      official: 'https://open.cherryin.ai'
    }
  },
  overrides: deepSeekModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }))
})
