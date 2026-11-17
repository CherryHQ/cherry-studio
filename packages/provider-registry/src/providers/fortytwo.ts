import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'fortytwo',
  name: 'Fortytwo',
  availableInEditions: ['global'],
  baseUrl: 'https://api.fortytwo.network/v1',
  reasoningFormat: { type: 'openai-chat' },
  website: {
    apiKey: 'https://platform.fortytwo.network',
    docs: 'https://docs.fortytwo.network',
    models: 'https://docs.fortytwo.network/docs/models',
    official: 'https://fortytwo.network'
  },
  overrides: [
    {
      modelId: 'qwen3-8-27b',
      apiModelId: 'qwen/qwen3.8-27b',
      endpointTypes: ['openai-chat-completions'],
      capabilities: { force: ['function-call', 'reasoning', 'image-recognition', 'structured-output'] },
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      limits: { contextWindow: 262144, maxOutputTokens: 235929 },
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.425 },
        output: { currency: 'USD', perMillionTokens: 2.55 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.085 },
        cacheWrite: { currency: 'USD', perMillionTokens: 0 },
        inputTokenTiers: []
      },
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }]
          }
        }
      }
    }
  ]
})
