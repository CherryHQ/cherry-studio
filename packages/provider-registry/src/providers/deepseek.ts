import type { ReasoningSupport } from '../schemas/model'
import { defineProvider } from './types'

/**
 * V4 speaks two different off-switches (api-docs.deepseek.com/zh-cn/guides/thinking_mode):
 * chat-completions toggles `thinking.type`, while the Responses API has a real
 * `none` effort tier. Declaring the ladder per endpoint keeps `reasoning_effort:
 * "none"` — a 400 on chat — off the chat wire (#17900).
 */
const V4_EFFORTS = ['low', 'high', 'xhigh', 'max'] as const

const chatSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: [...V4_EFFORTS] }, { kind: 'toggle' }]
}

const responsesSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', ...V4_EFFORTS] }]
}

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
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: ['deepseek-v4-flash'],
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
        'openai-chat-completions': { support: chatSupport, wire: flashChatEffortWire },
        'openai-responses': { support: responsesSupport, wire: responsesEffortWire }
      }
    },
    {
      modelId: 'deepseek-v4-pro',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      reasoningContracts: {
        'openai-chat-completions': { support: chatSupport, wire: proChatEffortWire }
      }
    }
  ]
})
