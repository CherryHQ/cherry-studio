import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

const webSearchModelPrefixes = [
  'qwen3-8-max',
  'qwen3-8-max-preview',
  'qwen3-7-max',
  'qwen3-6-max-preview',
  'qwen3-max',
  'qwen3-7-plus',
  'qwen3-6-plus',
  'qwen3-5-plus',
  'qwen-plus',
  'qwen3-6-flash',
  'qwen3-5-flash',
  'qwen-flash',
  'qwen-turbo',
  'qwq-plus',
  'qwen-plus-character',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v3-2',
  'deepseek-v3-1',
  'deepseek-r1',
  'deepseek-v3',
  'gemini-2',
  'gemini-3',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest',
  'kimi-k2',
  'kimi-k3',
  'kimi-latest',
  'gpt-4o',
  'gpt-4-1',
  'gpt-5',
  'o3',
  'o4',
  'sonar',
  'grok-4',
  'glm-4',
  'glm-5'
]

const webSearchModelIds = [
  'doubao-seed-1-8',
  'doubao-seed-2-1-pro',
  'doubao-seed-2-1-turbo',
  'doubao-seed-evolving',
  'doubao-seed-2-0-pro',
  'doubao-seed-2-0-lite',
  'doubao-seed-2-0-mini',
  'doubao-seed-2-0-code-preview',
  'doubao-seed-1-6',
  'doubao-seed-character',
  'minimax-m2-1'
]

const effortWire = modeWire(
  'extra_body.reasoning_effort',
  { off: 'none', auto: EFFORT, effort: EFFORT },
  { autoEffort: 'medium' }
)

const thinkingBudgetWire: ReasoningWireProfile = {
  auto: {
    operations: [{ target: 'extra_body.thinking_budget', value: { source: 'budget' } }],
    budget: { missing: { type: 'omit-mode' } }
  },
  effort: {
    operations: [{ target: 'extra_body.thinking_budget', value: { source: 'budget' } }],
    budget: { missing: { type: 'omit-mode' } }
  }
}

// Poe's Responses emulation breaks Claude streams, so official bots prefer Anthropic.
// The 4.5 line uses budget thinking; later models use effort controls.
const claudeModels: { apiModelId: string; modelId: string }[] = [
  { apiModelId: 'Claude-Opus-4.8', modelId: 'claude-opus-4-8' },
  { apiModelId: 'Claude-Opus-4.7', modelId: 'claude-opus-4-7' },
  { apiModelId: 'Claude-Opus-4.6', modelId: 'claude-opus-4-6' },
  { apiModelId: 'Claude-Sonnet-4.6', modelId: 'claude-sonnet-4-6' },
  { apiModelId: 'claude-opus-4.5', modelId: 'claude-opus-4-5' },
  { apiModelId: 'claude-sonnet-4.5', modelId: 'claude-sonnet-4-5' },
  { apiModelId: 'claude-haiku-4.5', modelId: 'claude-haiku-4-5' }
]

export default defineProvider({
  id: 'poe',
  name: 'Poe',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.poe.com/v1/',
      reasoningFormat: { type: 'openai-responses' }
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.poe.com/v1/',
      // Poe silently ignores top-level reasoning_effort. Unknown/community bots
      // stay fail-closed until their custom parameter contract is known.
      reasoningFormat: { type: 'openai-chat', wire: { disabled: true } },
      dialect: { developerRole: false }
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.poe.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://poe.com/api/keys',
      docs: 'https://creator.poe.com/docs',
      models: 'https://poe.com/api/models',
      official: 'https://poe.com/'
    }
  },
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: webSearchModelPrefixes,
      modelIds: webSearchModelIds,
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview']
    }
  ],
  overrides: [
    {
      apiModelId: 'GPT-5.4',
      modelId: 'gpt-5-4',
      reasoningContracts: {
        'openai-chat-completions': { wire: effortWire }
      }
    },
    {
      apiModelId: 'Gemini-3.1-Pro',
      modelId: 'gemini-3-1-pro-preview',
      reasoningContracts: {
        'openai-chat-completions': { wire: thinkingBudgetWire }
      }
    },
    ...claudeModels.map(({ apiModelId, modelId }) => ({
      apiModelId,
      modelId,
      endpointTypes: ['anthropic-messages' as const, 'openai-chat-completions' as const],
      reasoningContracts: {
        'openai-chat-completions': { wire: thinkingBudgetWire }
      }
    }))
  ]
})
