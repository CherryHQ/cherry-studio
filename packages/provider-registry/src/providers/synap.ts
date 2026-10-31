import { openaiCompatible } from './types'

/**
 * Synap serves its 5 self-hosted fleet models exclusively on Linkrra-operated GPUs (refused with
 * a 503 rather than routed to any third-party backend if no fleet node is online). The pricing
 * and context windows below mirror the live feed at pool.linkrra.com/v1/models.
 */
export default openaiCompatible({
  id: 'synap',
  name: 'Synap',
  availableInEditions: ['global'],
  baseUrl: 'https://pool.linkrra.com/v1',
  website: {
    apiKey: 'https://synap.linkrra.com',
    docs: 'https://synap.linkrra.com/pricing',
    models: 'https://pool.linkrra.com/v1/models',
    official: 'https://synap.linkrra.com'
  },
  overrides: [
    {
      apiModelId: 'gpt-oss-20b',
      modelId: 'gpt-oss-20b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.017 },
        output: { currency: 'USD', perMillionTokens: 0.085 }
      }
    },
    {
      apiModelId: 'gemma-4-26b-a4b-it',
      limits: { contextWindow: 131072 },
      modelId: 'gemma-4-26b-a4b-it',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.04 },
        output: { currency: 'USD', perMillionTokens: 0.21 }
      }
    },
    {
      apiModelId: 'qwen3-coder-30b',
      limits: { contextWindow: 98304 },
      modelId: 'qwen3-coder-30b-a3b-instruct',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.0675 },
        output: { currency: 'USD', perMillionTokens: 0.27 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-30b-a3b-instruct-2507',
      limits: { contextWindow: 98304 },
      modelId: 'qwen3-30b-a3b-instruct',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.085 },
        output: { currency: 'USD', perMillionTokens: 0.28 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-vl-30b-a3b-instruct',
      limits: { contextWindow: 65536 },
      modelId: 'qwen3-vl-30b-a3b-instruct',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.14 },
        output: { currency: 'USD', perMillionTokens: 0.55 }
      }
    }
  ]
})
