import { defineProvider } from './types'

const effortWire = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: {
      auto: 'high' as const,
      minimal: 'high' as const,
      low: 'high' as const,
      medium: 'high' as const,
      xhigh: 'max' as const
    }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: { minimal: 'high' as const, low: 'high' as const, medium: 'high' as const, xhigh: 'max' as const }
  }
}

export default defineProvider({
  id: 'deepseek',
  name: 'deepseek',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic'
    },
    'openai-chat-completions': {
      adapterFamily: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
          auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
          effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
        }
      }
    }
  },
  apiFeatures: {
    arrayContent: false
  },
  metadata: {
    website: {
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/api-docs/',
      models: 'https://platform.deepseek.com/api-docs/',
      official: 'https://deepseek.com/'
    }
  },
  overrides: [
    { modelId: 'deepseek-chat' },
    { modelId: 'deepseek-reasoner' },
    ...['deepseek-v4-flash', 'deepseek-v4-pro'].map((modelId) => ({
      modelId,
      reasoningContracts: {
        'openai-chat-completions': { wire: effortWire }
      }
    }))
  ]
})
