import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { openaiCompatible } from './types'

const effortWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'extra_body.reasoning_effort', value: { source: 'literal', value: 'none' } }]
  },
  auto: {
    operations: [{ target: 'extra_body.reasoning_effort', value: { source: 'effort' } }],
    effortMap: { auto: 'medium' }
  },
  effort: {
    operations: [{ target: 'extra_body.reasoning_effort', value: { source: 'effort' } }]
  }
}

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

// Official Claude bots on Poe. They route through Poe's Anthropic-compatible
// endpoint by default; only official Claude models are served there. These are
// all adaptive-effort SKUs (4.6+/5.x/Fable), so anthropic-messages uses the
// built-in anthropic effort wire — no per-model contract needed. openai-chat-
// completions stays as a fallback carrying Poe's thinking_budget contract.
// `apiModelId` is the exact Poe bot name (differs from the canonical modelId).
const claudeModels: { apiModelId: string; modelId: string }[] = [
  { apiModelId: 'Claude-Fable-5', modelId: 'claude-fable-5' },
  { apiModelId: 'Claude-Sonnet-5', modelId: 'claude-sonnet-5' },
  { apiModelId: 'Claude-Opus-4.8', modelId: 'claude-opus-4-8' },
  { apiModelId: 'Claude-Opus-4.7', modelId: 'claude-opus-4-7' },
  { apiModelId: 'Claude-Opus-4.6', modelId: 'claude-opus-4-6' },
  { apiModelId: 'Claude-Sonnet-4.6', modelId: 'claude-sonnet-4-6' }
]

export default openaiCompatible({
  id: 'poe',
  name: 'Poe',
  baseUrl: 'https://api.poe.com/v1/',
  // Poe silently ignores top-level reasoning_effort. Unknown/community bots
  // stay fail-closed until their custom parameter contract is known.
  reasoningFormat: { type: 'openai-chat', wire: { disabled: true } },
  anthropic: 'https://api.poe.com',
  website: {
    apiKey: 'https://poe.com/api/keys',
    docs: 'https://creator.poe.com/docs/external-applications/openai-compatible-api',
    models: 'https://poe.com/',
    official: 'https://poe.com/'
  },
  apiFeatures: {
    arrayContent: false,
    developerRole: false
  },
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
