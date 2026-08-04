import { defineProvider } from './types'

const flashEffortMap = {
  minimal: 'low' as const,
  low: 'low' as const,
  medium: 'high' as const,
  xhigh: 'max' as const
}

const proEffortMap = {
  minimal: 'high' as const,
  low: 'high' as const,
  medium: 'high' as const,
  xhigh: 'max' as const
}

const flashChatEffortWire = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: { auto: 'high' as const, ...flashEffortMap }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: flashEffortMap
  }
}

const proChatEffortWire = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: { auto: 'high' as const, ...proEffortMap }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: proEffortMap
  }
}

const responsesEffortWire = {
  off: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'literal' as const, value: 'none' } }]
  },
  auto: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: { auto: 'high' as const, ...flashEffortMap }
  },
  effort: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: flashEffortMap
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
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.deepseek.com',
      reasoningFormat: { type: 'openai-responses' }
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
    { modelId: 'deepseek-chat', endpointTypes: ['openai-chat-completions'] },
    { modelId: 'deepseek-reasoner', endpointTypes: ['openai-chat-completions'] },
    {
      modelId: 'deepseek-v4-flash',
      endpointTypes: ['openai-chat-completions', 'openai-responses'],
      reasoningContracts: {
        'openai-chat-completions': { wire: flashChatEffortWire },
        'openai-responses': { wire: responsesEffortWire }
      }
    },
    {
      modelId: 'deepseek-v4-pro',
      endpointTypes: ['openai-chat-completions'],
      reasoningContracts: {
        'openai-chat-completions': { wire: proChatEffortWire }
      }
    }
  ]
})
