import { defineProvider } from './types'

const hybridWire = {
  off: { operations: [{ target: 'reasoning.enabled' as const, value: { source: 'literal' as const, value: false } }] },
  auto: { operations: [{ target: 'reasoning.enabled' as const, value: { source: 'literal' as const, value: true } }] },
  effort: { operations: [{ target: 'reasoning.enabled' as const, value: { source: 'literal' as const, value: true } }] }
}

const adjustableWire = {
  effort: { operations: [{ target: 'reasoning_effort' as const, value: { source: 'effort' as const } }] }
}

const deepSeekV4Wire = {
  off: { operations: [{ target: 'reasoning.enabled' as const, value: { source: 'literal' as const, value: false } }] },
  effort: {
    operations: [{ target: 'reasoning_effort' as const, value: { source: 'effort' as const } }],
    effortMap: { minimal: 'high' as const, low: 'high' as const, medium: 'high' as const, xhigh: 'max' as const }
  }
}

const hybridModels = [
  { apiModelId: 'zai-org/GLM-5', modelId: 'glm-5' },
  { apiModelId: 'moonshotai/Kimi-K2.6', modelId: 'kimi-k2-6' },
  { apiModelId: 'Qwen/Qwen3.6-Plus', modelId: 'qwen3-6-plus' },
  { apiModelId: 'Qwen/Qwen3.5-9B', modelId: 'qwen3-5-9b' }
]

const adjustableModels = [
  { apiModelId: 'openai/gpt-oss-120b', modelId: 'gpt-oss-120b' },
  { apiModelId: 'openai/gpt-oss-20b', modelId: 'gpt-oss-20b' }
]

export default defineProvider({
  id: 'together',
  name: 'Together',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'togetherai',
      baseUrl: 'https://api.together.ai',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://api.together.ai/settings/projects/~current/api-keys',
      docs: 'https://docs.together.ai/intro',
      models: 'https://docs.together.ai/docs/serverless/models',
      official: 'https://www.together.ai'
    }
  },
  overrides: [
    ...hybridModels.map(({ apiModelId, modelId }) => ({
      apiModelId,
      modelId,
      reasoningContracts: {
        'openai-chat-completions': {
          support: { controls: [{ kind: 'toggle' as const, default: true }] },
          wire: hybridWire
        }
      }
    })),
    ...adjustableModels.map(({ apiModelId, modelId }) => ({
      apiModelId,
      modelId,
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ kind: 'effort' as const, values: ['low' as const, 'medium' as const, 'high' as const] }]
          },
          wire: adjustableWire
        }
      }
    })),
    {
      apiModelId: 'deepseek-ai/DeepSeek-V4-Pro',
      modelId: 'deepseek-v4-pro',
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }]
          },
          wire: deepSeekV4Wire
        }
      }
    },
    {
      apiModelId: 'MiniMaxAI/MiniMax-M2.7',
      modelId: 'minimax-m2-7',
      reasoningContracts: {
        'openai-chat-completions': { support: { controls: [] }, wire: { disabled: true } }
      }
    }
  ]
})
