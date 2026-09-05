import { openaiCompatible } from './types'
import { EFFORT, modeWire } from './wires'

const effortWire = modeWire('reasoningEffort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })

const fixedSamplingParameterSupport = {
  temperature: { supported: false },
  topP: { supported: false }
} as const

export default openaiCompatible({
  id: 'moonshot',
  name: 'Moonshot AI',
  availableInEditions: ['global', 'cn'],
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
    // Moonshot fixes temperature and top_p (0.95) for these models and rejects other
    // values with HTTP 400; omitting the non-configurable parameters uses the server defaults.
    { modelId: 'kimi-k2.5', parameterSupport: fixedSamplingParameterSupport },
    ...['kimi-k2.6', 'kimi-k3'].map((modelId) => ({
      modelId,
      parameterSupport: fixedSamplingParameterSupport,
      reasoningContracts: {
        'openai-chat-completions': { wire: effortWire }
      }
    }))
  ]
})
