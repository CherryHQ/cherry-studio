import { defineProvider } from './types'

// api-docs.deepseek.com/zh-cn/guides/thinking_mode documents ONE effort table for V4 Flash and V4
// Pro ("deepseek-v4-flash 与 deepseek-v4-pro 一致"). `xhigh` is sent as `max` because DeepSeek
// degrades its own `xhigh` to `high`, leaving `max` as the only way to reach the top level.
const v4EffortMap = {
  minimal: 'low' as const,
  low: 'low' as const,
  medium: 'high' as const,
  xhigh: 'max' as const
}

const v4ChatEffortWire = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: { auto: 'high' as const, ...v4EffortMap }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoning_effort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: v4EffortMap
  }
}

const v4ResponsesEffortWire = {
  off: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'literal' as const, value: 'none' } }]
  },
  auto: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: { auto: 'high' as const, ...v4EffortMap }
  },
  effort: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: v4EffortMap
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
          auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] },
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
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      endpointTypes: ['openai-responses']
    }
  ],
  metadata: {
    website: {
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/api-docs/',
      models: 'https://platform.deepseek.com/api-docs/',
      official: 'https://deepseek.com/'
    }
  },
  // The Anthropic-compatible endpoint serves V4 Pro / V4 Flash only, and silently maps any other
  // model name onto v4-flash — so it is pinned on those two and withheld from chat/reasoner. It
  // trails Chat Completions because `endpointTypes[0]` routes in-app chat.
  overrides: [
    { modelId: 'deepseek-chat', endpointTypes: ['openai-chat-completions'] },
    { modelId: 'deepseek-reasoner', endpointTypes: ['openai-chat-completions'] },
    {
      modelId: 'deepseek-v4-flash',
      endpointTypes: ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'openai-chat-completions': { wire: v4ChatEffortWire },
        'openai-responses': { wire: v4ResponsesEffortWire }
      }
    },
    {
      modelId: 'deepseek-v4-pro',
      endpointTypes: ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'openai-chat-completions': { wire: v4ChatEffortWire },
        'openai-responses': { wire: v4ResponsesEffortWire }
      }
    }
  ]
})
