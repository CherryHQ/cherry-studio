import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'mizumi',
  name: 'Mizumi',
  availableInEditions: ['global'],
  baseUrl: 'https://api.mizumi.co/v1',
  website: {
    apiKey: 'https://mizumi.co',
    docs: 'https://mizumi.co/docs',
    models: 'https://mizumi.co/docs',
    official: 'https://mizumi.co'
  },
  overrides: [
    {
      apiModelId: 'gpt-5.6-sol',
      modelId: 'gpt-5-6-sol',
      name: 'GPT-5.6 Sol',
      // No cached-token discount on the Mizumi gateway — cacheRead equals input.
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 4.5 },
        input: { currency: 'USD', perMillionTokens: 4.5 },
        output: { currency: 'USD', perMillionTokens: 27 }
      }
    },
    {
      apiModelId: 'gpt-5.6-terra',
      modelId: 'gpt-5-6-terra',
      name: 'GPT-5.6 Terra',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 1.8 },
        input: { currency: 'USD', perMillionTokens: 1.8 },
        output: { currency: 'USD', perMillionTokens: 10.8 }
      }
    },
    {
      apiModelId: 'gpt-5.6-luna',
      modelId: 'gpt-5-6-luna',
      name: 'GPT-5.6 Luna',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.18 },
        input: { currency: 'USD', perMillionTokens: 0.18 },
        output: { currency: 'USD', perMillionTokens: 1.08 }
      }
    },
    {
      apiModelId: 'gpt-5.5',
      modelId: 'gpt-5-5',
      name: 'GPT-5.5',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 4.5 },
        input: { currency: 'USD', perMillionTokens: 4.5 },
        output: { currency: 'USD', perMillionTokens: 27 }
      }
    },
    {
      apiModelId: 'gpt-5.4',
      modelId: 'gpt-5-4',
      name: 'GPT-5.4',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 2.25 },
        input: { currency: 'USD', perMillionTokens: 2.25 },
        output: { currency: 'USD', perMillionTokens: 13.5 }
      }
    },
    {
      apiModelId: 'gpt-4.1-mini',
      modelId: 'gpt-4-1-mini',
      name: 'GPT-4.1 Mini',
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.36 },
        input: { currency: 'USD', perMillionTokens: 0.36 },
        output: { currency: 'USD', perMillionTokens: 1.44 }
      }
    }
  ]
})
