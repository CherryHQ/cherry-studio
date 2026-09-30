import type { ProviderReasoningFormat } from '../schemas/provider'
import type { Provider } from './types'
import { openaiCompatible, type ProviderServerToolConfig } from './types'
import { EFFORT, modeWire } from './wires'

const effortWire = modeWire('reasoningEffort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })

const fixedSamplingParameterSupport = {
  temperature: { supported: false },
  topP: { supported: false }
} as const

// Shared with moonshot-global: the international endpoint speaks the same API.
export const moonshotReasoningFormat: ProviderReasoningFormat = {
  type: 'openai-chat',
  wire: {
    off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
    auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
    effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
  }
}

// Kimi web search is delivered by the Moonshot extension's formula tool.
export const moonshotServerTools: ProviderServerToolConfig[] = [
  {
    id: 'web-search',
    modelScope: 'model-dependent',
    // The formula-backed delivery is implemented by the Moonshot OpenAI-compatible extension.
    // The Anthropic mirror uses the Anthropic adapter and has no compatible Moonshot-native search
    // contract yet, so advertising this capability there would route the wrong hosted-search tool.
    endpointTypes: ['openai-chat-completions'],
    modelIdPrefixes: ['kimi-k2', 'kimi-k3', 'kimi-latest'],
    vendors: ['kimi']
  }
]

export const moonshotOverrides = [
  // Moonshot fixes temperature and top_p (0.95) for these models and rejects other
  // values with HTTP 400; omitting the non-configurable parameters uses the server defaults.
  { modelId: 'kimi-k2.5', parameterSupport: fixedSamplingParameterSupport },
  // Moonshot's provider wire only carries `thinking.type`, so these SKUs need their own contract
  // for a chosen tier to reach the request at all.
  ...['kimi-k2.6', 'kimi-k3', 'kimi-k3-fast'].map((modelId) => ({
    modelId,
    parameterSupport: fixedSamplingParameterSupport,
    reasoningContracts: {
      'openai-chat-completions': { wire: effortWire }
    }
  })),
  ...['kimi-k2.7-code', 'kimi-k2.7-code-highspeed'].map((modelId) => ({
    modelId,
    parameterSupport: fixedSamplingParameterSupport
  }))
] satisfies NonNullable<Provider['overrides']>

export default openaiCompatible({
  id: 'moonshot',
  name: 'Moonshot AI',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.moonshot.cn',
  reasoningFormat: moonshotReasoningFormat,
  anthropic: 'https://api.moonshot.cn/anthropic',
  serverTools: moonshotServerTools,
  website: {
    apiKey: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs/',
    models: 'https://platform.moonshot.cn/docs/',
    official: 'https://www.moonshot.cn/'
  },
  overrides: moonshotOverrides
})
