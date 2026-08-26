import { defineProvider } from './types'

// Token Plan is TokenHub's subscription tier: a separate base URL serving a much narrower catalog than
// the pay-as-you-go platform, so it carries its own override rows rather than sharing TokenHub's.
// Models and apiModelIds are verbatim from cloud.tencent.com/document/product/1823/130060 — the
// DeepSeek SKUs are the dated 原厂直供 builds only, and no image/video model is offered. It speaks Chat
// Completions and Anthropic Messages; there is no Responses endpoint.
export default defineProvider({
  id: 'token-plan',
  name: 'Token Plan',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.lkeap.cloud.tencent.com/plan/anthropic' },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.lkeap.cloud.tencent.com/plan/v3'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.cloud.tencent.com/tokenhub/tokenplan/common',
      docs: 'https://cloud.tencent.com/document/product/1823',
      models: 'https://cloud.tencent.com/document/product/1823/130060',
      official: 'https://cloud.tencent.com/document/product/1823/130060'
    }
  },
  modelListSource: 'registry',
  overrides: [
    // Hy Token Plan tier. The platform auto-routes hy3-preview onto Hy3.
    { modelId: 'hy3', apiModelId: 'hy3' },
    { modelId: 'hy3-preview', apiModelId: 'hy3-preview' },
    { modelId: 'hy4-preview', apiModelId: 'hy4-preview' },
    // General tier. `tc-code-latest` is the Auto router, not a fixed SKU.
    { modelId: 'tc-code', apiModelId: 'tc-code-latest' },
    { modelId: 'deepseek-v4-flash', apiModelId: 'deepseek-v4-flash-202605' },
    { modelId: 'deepseek-v4-pro', apiModelId: 'deepseek-v4-pro-202606' },
    { modelId: 'minimax-m2-7', apiModelId: 'minimax-m2.7' },
    { modelId: 'glm-5', apiModelId: 'glm-5' },
    { modelId: 'glm-5-1', apiModelId: 'glm-5.1' },
    { modelId: 'glm-5-2', apiModelId: 'glm-5.2' },
    // Retires 2026-08-31 per the plan docs; kept while the platform still serves it.
    { modelId: 'kimi-k2-5', apiModelId: 'kimi-k2.5' }
  ]
})
