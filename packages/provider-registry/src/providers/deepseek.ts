import { defineProvider } from './types'

// https://api-docs.deepseek.com/guides/thinking_mode lists the supported effort levels.
// Keep xhigh as a compatibility input, translated to the supported max value.
const v4EffortMap = {
  minimal: 'low' as const,
  low: 'low' as const,
  medium: 'high' as const,
  xhigh: 'max' as const
}

const v4FlashPeakPricing = {
  cacheRead: { currency: 'USD' as const, perMillionTokens: 0.006 },
  input: { currency: 'USD' as const, perMillionTokens: 0.3 },
  output: { currency: 'USD' as const, perMillionTokens: 1.2 }
}

const v4ProPeakPricing = {
  cacheRead: { currency: 'USD' as const, perMillionTokens: 0.044 },
  input: { currency: 'USD' as const, perMillionTokens: 1.32 },
  output: { currency: 'USD' as const, perMillionTokens: 3.96 }
}

// Targets name `@ai-sdk/deepseek` provider options, not wire fields: the SDK's zod schema takes
// camelCase `reasoningEffort` and silently strips the snake_case form before it reaches the body.
const v4ChatEffortWire = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoningEffort' as const, value: { source: 'effort' as const } }
    ],
    effortMap: { auto: 'high' as const, ...v4EffortMap }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'reasoningEffort' as const, value: { source: 'effort' as const } }
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
  availableInEditions: ['global', 'cn'],
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
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: ['deepseek-flash', 'deepseek-v4-pro'],
      endpointTypes: ['openai-responses']
    }
  ],
  metadata: {
    website: {
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://api-docs.deepseek.com/',
      models: 'https://api-docs.deepseek.com/',
      official: 'https://deepseek.com/'
    }
  },
  overrides: [
    {
      modelId: 'deepseek-flash',
      endpointTypes: ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
      pricing: v4FlashPeakPricing,
      reasoningContracts: {
        'openai-chat-completions': { wire: v4ChatEffortWire },
        'openai-responses': { wire: v4ResponsesEffortWire }
      }
    },
    {
      modelId: 'deepseek-v4-pro',
      endpointTypes: ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
      limits: { maxOutputTokens: 384000 },
      pricing: v4ProPeakPricing,
      reasoningContracts: {
        'openai-chat-completions': { wire: v4ChatEffortWire },
        'openai-responses': { wire: v4ResponsesEffortWire }
      }
    }
  ]
})
