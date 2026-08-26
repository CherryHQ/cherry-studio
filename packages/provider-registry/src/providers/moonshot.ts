import { openaiCompatible } from './types'
import { EFFORT, modeWire } from './wires'

const effortWire = modeWire('reasoningEffort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })

const fixedTopPParameterSupport = { topP: { supported: false } } as const

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
  // Kimi's $web_search builtin (platform.kimi.com use-web-search), delivered by
  // the moonshot extension's echo tool + builtin_function body rewrite.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: ['kimi-k2', 'kimi-k3', 'kimi-latest'],
      vendors: ['kimi']
    }
  ],
  website: {
    apiKey: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs/',
    models: 'https://platform.moonshot.cn/docs/',
    official: 'https://www.moonshot.cn/'
  },
  overrides: [
    // Moonshot fixes top_p at 0.95 for these models. Omitting the non-configurable
    // parameter uses that server default; sending Cherry's default of 1 is rejected.
    { modelId: 'kimi-k2.5', parameterSupport: fixedTopPParameterSupport },
    ...['kimi-k2.6', 'kimi-k3'].map((modelId) => ({
      modelId,
      ...(modelId === 'kimi-k3' ? { parameterSupport: fixedTopPParameterSupport } : {}),
      reasoningContracts: {
        'openai-chat-completions': { wire: effortWire }
      }
    }))
  ]
})
