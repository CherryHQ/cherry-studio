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
  id: 'new-api',
  name: 'New API',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      baseUrl: 'http://localhost:3000'
    },
    'google-generate-content': {
      baseUrl: 'http://localhost:3000'
    }
  },
  metadata: {
    website: {
      docs: 'https://docs.newapi.pro',
      official: 'https://docs.newapi.pro/'
    }
  },
  overrides: deepSeekModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }))
})
