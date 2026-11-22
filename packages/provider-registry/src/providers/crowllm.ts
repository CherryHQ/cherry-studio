import { openaiCompatible } from './types'

/**
 * CrowLLM is an OpenAI-compatible gateway: one endpoint and one key for every
 * model, with a zero-rated `:free` shelf next to the paid ids.
 *
 * The provider is not in models.dev yet, so the served models this preset
 * exposes are declared as standalone overrides (name, limits and the gateway's
 * live per-million-token rates from https://crowllm.com/api/pricing).
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
      limits: { contextWindow: 128000, maxOutputTokens: 16384 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.14 },
        output: { currency: 'USD', perMillionTokens: 0.55 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.014 }
      }
    },
    {
      modelId: 'glm-5.3',
      apiModelId: 'glm-5.3',
      name: 'GLM 5.3',
      family: 'glm',
      ownedBy: 'zhipu',
      limits: { contextWindow: 200000, maxOutputTokens: 32768 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.5976 },
        output: { currency: 'USD', perMillionTokens: 2.09155 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.149395 }
      }
    },
    {
      modelId: 'kimi-k3',
      apiModelId: 'kimi-k3',
      name: 'Kimi K3',
      family: 'kimi',
      ownedBy: 'moonshot',
      limits: { contextWindow: 256000, maxOutputTokens: 32768 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2.49 },
        output: { currency: 'USD', perMillionTokens: 12.99 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.223 }
      }
    },
    {
      modelId: 'claude-opus-4-7',
      apiModelId: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      family: 'claude',
      ownedBy: 'anthropic',
      limits: { contextWindow: 200000, maxOutputTokens: 32000 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 4 },
        output: { currency: 'USD', perMillionTokens: 20 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.35 }
      }
    },
    {
      modelId: 'gemini-3.7-flash',
      apiModelId: 'gemini-3.7-flash',
      name: 'Gemini 3.7 Flash',
      family: 'gemini',
      ownedBy: 'google',
      limits: { contextWindow: 1000000, maxOutputTokens: 65536 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.75 },
        output: { currency: 'USD', perMillionTokens: 3.75 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.09 }
      }
    }
  ]
})
