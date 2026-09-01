import type { ReasoningEffort } from '../schemas/enums'
import type { ReasoningSupport } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const FIREWORKS_ENDPOINTS = ['openai-responses', 'anthropic-messages', 'openai-chat-completions'] as const

// Fireworks does not support Anthropic adaptive thinking. Enabled thinking
// requires a budget of at least 1024 tokens; output_config.effort controls the
// actual effort tier, with max normalized to high by Fireworks.
const anthropicWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }]
  },
  auto: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
      { target: 'thinking.budgetTokens', value: { source: 'literal', value: 1024 } }
    ]
  },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
      { target: 'thinking.budgetTokens', value: { source: 'literal', value: 1024 } },
      { target: 'effort', value: { source: 'effort' } }
    ],
    effortMap: { max: 'high' }
  }
}

const toggleSupport: ReasoningSupport = {
  controls: [{ kind: 'toggle' }]
}

const effortSupport = (values: ReasoningEffort[]): ReasoningSupport => ({
  controls: [{ kind: 'effort', values }]
})

const adjustableSupport = (values: ReasoningEffort[]): ReasoningSupport => ({
  controls: [{ kind: 'effort', values }, { kind: 'toggle' }]
})

const reasoningContracts = (support: ReasoningSupport): ProviderModelOverride['reasoningContracts'] => ({
  'anthropic-messages': { support },
  'openai-chat-completions': { support },
  'openai-responses': { support }
})

const override = (modelId: string, support: ReasoningSupport): Partial<ProviderModelOverride> => ({
  modelId,
  endpointTypes: [...FIREWORKS_ENDPOINTS],
  reasoningContracts: reasoningContracts(support)
})

const toggleModels = ['kimi-k2-6', 'kimi-k2-7-code']

// `/v1/models` does not reliably list router-backed variants; keep the exact IDs
// advertised by Fireworks' serving-path and integration docs.
const fastToggleModels: Array<{
  modelId: string
  name: string
  pricing: NonNullable<ProviderModelOverride['pricing']>
}> = [
  {
    modelId: 'accounts/fireworks/routers/kimi-k2p6-fast',
    name: 'Kimi K2.6 Fast',
    pricing: {
      cacheRead: { currency: 'USD', perMillionTokens: 0.3 },
      input: { currency: 'USD', perMillionTokens: 2 },
      output: { currency: 'USD', perMillionTokens: 8 }
    }
  },
  {
    modelId: 'accounts/fireworks/routers/kimi-k2p6-turbo',
    name: 'Kimi K2.6 Turbo',
    pricing: {
      cacheRead: { currency: 'USD', perMillionTokens: 0.3 },
      input: { currency: 'USD', perMillionTokens: 2 },
      output: { currency: 'USD', perMillionTokens: 8 }
    }
  },
  {
    modelId: 'accounts/fireworks/routers/kimi-k2p7-code-fast',
    name: 'Kimi K2.7 Code Fast',
    pricing: {
      cacheRead: { currency: 'USD', perMillionTokens: 0.38 },
      input: { currency: 'USD', perMillionTokens: 1.9 },
      output: { currency: 'USD', perMillionTokens: 8 }
    }
  }
]

const effortModels: Array<{ modelId: string; values: ReasoningEffort[] }> = [
  { modelId: 'gpt-oss-120b', values: ['low', 'medium', 'high'] },
  { modelId: 'minimax-m3', values: ['low', 'medium', 'high'] }
]

const adjustableModels: Array<{ modelId: string; values: ReasoningEffort[] }> = [
  { modelId: 'deepseek-v4-flash', values: ['high', 'max'] },
  { modelId: 'deepseek-v4-pro', values: ['high', 'max'] },
  { modelId: 'glm-5-2', values: ['high', 'max'] },
  { modelId: 'glm-5-2-fast', values: ['high', 'max'] },
  { modelId: 'qwen3-7-plus', values: ['low', 'medium', 'high'] }
]

export default defineProvider({
  id: 'fireworks',
  name: 'Fireworks',
  supportedEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.fireworks.ai/inference',
      reasoningFormat: { type: 'anthropic', wire: anthropicWire }
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.fireworks.ai/inference',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.fireworks.ai/inference',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://fireworks.ai/account/api-keys',
      docs: 'https://docs.fireworks.ai/getting-started/introduction',
      models: 'https://fireworks.ai/dashboard/models',
      official: 'https://fireworks.ai/'
    }
  },
  modelsDevProvider: 'fireworks-ai',
  overrides: [
    ...toggleModels.map((modelId) => override(modelId, toggleSupport)),
    ...fastToggleModels.map((model) => ({ ...override(model.modelId, toggleSupport), ...model })),
    {
      ...override('glm-5-1-fast', toggleSupport),
      apiModelId: 'accounts/fireworks/routers/glm-5p1-fast',
      name: 'GLM 5.1 Fast',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.52 },
        input: { currency: 'USD', perMillionTokens: 2.8 },
        output: { currency: 'USD', perMillionTokens: 8.8 }
      }
    },
    {
      ...override('gpt-oss-20b', effortSupport(['low', 'medium', 'high'])),
      apiModelId: 'accounts/fireworks/models/gpt-oss-20b',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.035 },
        input: { currency: 'USD', perMillionTokens: 0.07 },
        output: { currency: 'USD', perMillionTokens: 0.3 }
      }
    },
    {
      ...override('minimax-m2-7', effortSupport(['low', 'medium', 'high'])),
      apiModelId: 'accounts/fireworks/models/minimax-m2p7',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.059 },
        input: { currency: 'USD', perMillionTokens: 0.3 },
        output: { currency: 'USD', perMillionTokens: 1.2 }
      }
    },
    ...effortModels.map(({ modelId, values }) => override(modelId, effortSupport(values))),
    ...adjustableModels.map(({ modelId, values }) => override(modelId, adjustableSupport(values)))
  ]
})
