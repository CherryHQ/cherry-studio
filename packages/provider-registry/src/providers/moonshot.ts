import { openaiCompatible } from './types'

const effortWire = {
  off: { operations: [{ target: 'reasoningEffort' as const, value: { source: 'literal' as const, value: 'none' } }] },
  auto: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: { auto: 'medium' as const }
  },
  effort: { operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }] }
}

export default openaiCompatible({
  id: 'moonshot',
  name: 'Moonshot AI',
  baseUrl: 'https://api.moonshot.cn',
  reasoningFormat: {
    type: 'openai-chat',
    wire: {
      off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
      auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
      effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
    }
  },
  anthropic: 'https://api.moonshot.cn/anthropic',
  website: {
    apiKey: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs/',
    models: 'https://platform.moonshot.cn/docs/',
    official: 'https://www.moonshot.cn/'
  },
  overrides: ['kimi-k2-6', 'kimi-k3'].map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: effortWire }
    }
  }))
})
