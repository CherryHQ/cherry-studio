import type { ModelPricing } from '../schemas/model'
import type { ProviderReasoningFormat } from '../schemas/provider'
import { fixedSamplingParameterSupport } from './parameterSupports'
import type { Provider } from './types'
import { openaiCompatible, type ProviderServerToolConfig } from './types'
import { EFFORT, modeWire } from './wires'

const effortWire = modeWire('reasoningEffort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })
const K31_EFFORT_WIRE = modeWire('reasoningEffort', { auto: EFFORT, effort: EFFORT }, { autoEffort: 'max' })

// https://platform.kimi.com/docs/pricing/chat (default 5-minute cache writes).
const K31_CN_PRICING: Record<string, ModelPricing> = {
  'kimi-k3.1-pro': {
    input: { currency: 'CNY', perMillionTokens: 13 },
    output: { currency: 'CNY', perMillionTokens: 68 },
    cacheRead: { currency: 'CNY', perMillionTokens: 1.3 },
    cacheWrite: { currency: 'CNY', perMillionTokens: 13 }
  },
  'kimi-k3.1-pro-highspeed': {
    input: { currency: 'CNY', perMillionTokens: 26 },
    output: { currency: 'CNY', perMillionTokens: 136 },
    cacheRead: { currency: 'CNY', perMillionTokens: 1.3 },
    cacheWrite: { currency: 'CNY', perMillionTokens: 26 }
  }
}

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
  ...['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'].map<NonNullable<Provider['overrides']>[number]>((apiModelId) => ({
    apiModelId,
    endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
    reasoningContracts: {
      'openai-chat-completions': { wire: K31_EFFORT_WIRE },
      'anthropic-messages': {
        wire: modeWire('effort', { auto: EFFORT, effort: EFFORT }, { autoEffort: 'max' })
      }
    }
  })),
  // Moonshot fixes temperature and top_p (0.95) for these models and rejects other
  // values with HTTP 400; omitting the non-configurable parameters uses the server defaults.
  { apiModelId: 'kimi-k2.5', parameterSupport: fixedSamplingParameterSupport },
  // Moonshot's provider wire only carries `thinking.type`, so these SKUs need their own contract
  // for a chosen tier to reach the request at all.
  ...['kimi-k2.6', 'kimi-k3', 'kimi-k3-fast'].map((apiModelId) => ({
    apiModelId,
    parameterSupport: fixedSamplingParameterSupport,
    reasoningContracts: {
      'openai-chat-completions': { wire: effortWire }
    }
  })),
  ...['kimi-k2.7-code', 'kimi-k2.7-code-highspeed'].map((apiModelId) => ({
    apiModelId,
    parameterSupport: fixedSamplingParameterSupport
  })),
  // Rolling alias for the newest Kimi — same backend, same fixed sampling.
  { apiModelId: 'kimi-latest', parameterSupport: fixedSamplingParameterSupport }
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
  overrides: moonshotOverrides.map((override) => {
    const pricing = K31_CN_PRICING[override.apiModelId]
    return pricing ? { ...override, pricing } : override
  })
})
