import type { ProviderReasoningFormat } from '../schemas/provider'
import type { Provider } from './types'
import { openaiCompatible, type ProviderServerToolConfig } from './types'
import { EFFORT, modeWire } from './wires'

const effortWire = modeWire('reasoningEffort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })

// Shared with moonshot-global: the international endpoint speaks the same API.
export const moonshotReasoningFormat: ProviderReasoningFormat = {
  type: 'openai-chat',
  wire: {
    off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
    auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
    effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
  }
}

// Kimi's $web_search builtin (platform.kimi.com use-web-search), delivered by
// the moonshot extension's echo tool + builtin_function body rewrite.
export const moonshotServerTools: ProviderServerToolConfig[] = [
  {
    id: 'web-search',
    modelScope: 'model-dependent',
    modelIdPrefixes: ['kimi-k2', 'kimi-k3', 'kimi-latest'],
    vendors: ['kimi']
  }
]

export const moonshotReasoningOverrides = ['kimi-k2.6', 'kimi-k3'].map((modelId) => ({
  modelId,
  reasoningContracts: {
    'openai-chat-completions': { wire: effortWire }
  }
})) satisfies NonNullable<Provider['overrides']>

export default openaiCompatible({
  id: 'moonshot',
  name: 'Moonshot AI',
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
  overrides: moonshotReasoningOverrides
})
