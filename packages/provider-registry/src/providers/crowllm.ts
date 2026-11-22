import { openaiCompatible } from './types'

/**
 * CrowLLM is an OpenAI-compatible gateway: one endpoint and one key for every
 * model, with a zero-rated `:free` shelf next to the paid ids.
 *
 * The provider is not in models.dev yet, so the served models this preset
 * exposes are declared as standalone overrides (name + limits). Prices are
 * intentionally omitted; the live table is at https://crowllm.com/pricing.
 */
export default openaiCompatible({
  id: 'crowllm',
  name: 'CrowLLM',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://crowllm.com/v1',
  website: {
    apiKey: 'https://crowllm.com',
    docs: 'https://crowllm.com/docs',
    models: 'https://crowllm.com/docs',
    official: 'https://crowllm.com'
  },
  overrides: [
    {
      modelId: 'deepseek-v4-flash',
      apiModelId: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      family: 'deepseek',
      ownedBy: 'deepseek',
      limits: { contextWindow: 128000, maxOutputTokens: 16384 }
    },
    {
      modelId: 'glm-5.3',
      apiModelId: 'glm-5.3',
      name: 'GLM 5.3',
      family: 'glm',
      ownedBy: 'zhipu',
      limits: { contextWindow: 200000, maxOutputTokens: 32768 }
    },
    {
      modelId: 'kimi-k3',
      apiModelId: 'kimi-k3',
      name: 'Kimi K3',
      family: 'kimi',
      ownedBy: 'moonshot',
      limits: { contextWindow: 256000, maxOutputTokens: 32768 }
    },
    {
      modelId: 'claude-opus-4-7',
      apiModelId: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      family: 'claude',
      ownedBy: 'anthropic',
      limits: { contextWindow: 200000, maxOutputTokens: 32000 }
    },
    {
      modelId: 'gemini-3.7-flash',
      apiModelId: 'gemini-3.7-flash',
      name: 'Gemini 3.7 Flash',
      family: 'gemini',
      ownedBy: 'google',
      limits: { contextWindow: 1000000, maxOutputTokens: 65536 }
    },
    {
      modelId: 'qwen-3.8-27b:free',
      apiModelId: 'qwen-3.8-27b:free',
      name: 'Qwen 3.8 27B (free)',
      family: 'qwen',
      ownedBy: 'alibaba',
      limits: { contextWindow: 131072, maxOutputTokens: 16384 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0 },
        output: { currency: 'USD', perMillionTokens: 0 }
      }
    }
  ]
})
