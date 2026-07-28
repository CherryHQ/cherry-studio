import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const budgetThinkingWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'disabled' } }] },
  auto: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'thinking.budgetTokens' as const, value: { source: 'budget' as const } },
      { target: 'sendReasoning' as const, value: { source: 'literal' as const, value: true } }
    ],
    budget: { missing: { type: 'fallback', value: 13_312 }, clampToMaxTokens: true }
  },
  effort: {
    operations: [
      { target: 'thinking.type' as const, value: { source: 'literal' as const, value: 'enabled' } },
      { target: 'thinking.budgetTokens' as const, value: { source: 'budget' as const } },
      { target: 'sendReasoning' as const, value: { source: 'literal' as const, value: true } }
    ],
    budget: { missing: { type: 'fallback', value: 13_312 }, clampToMaxTokens: true }
  }
}

const budgetThinkingModels = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4',
  'claude-haiku-4-5',
  'claude-opus-4'
]

export default defineProvider({
  id: 'anthropic',
  name: 'Anthropic',
  defaultChatEndpoint: 'anthropic-messages',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.anthropic.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models',
      official: 'https://anthropic.com/'
    }
  },
  overrides: budgetThinkingModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'anthropic-messages': { wire: budgetThinkingWire }
    }
  }))
})
