import { defineCreator } from './types'

export default defineCreator({
  id: 'minimax',
  name: 'MiniMax',
  modelsDevProviders: ['minimax', 'minimax-cn'],
  idPrefixes: ['minimax', 'abab'],
  models: [
    {
      id: 'minimax-m3',
      name: 'MiniMax-M3',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      contextWindow: 1000000,
      inputModalities: ['text', 'image', 'video'],
      maxOutputTokens: 1000000,
      openWeights: true,
      outputModalities: ['text'],
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.12 },
        input: { currency: 'USD', perMillionTokens: 0.6 },
        output: { currency: 'USD', perMillionTokens: 2.4 }
      },
      reasoning: { supportedEfforts: ['none', 'auto'] }
    },
    {
      id: 'minimax-m2-7',
      name: 'MiniMax-M2.7',
      capabilities: ['function-call', 'reasoning', 'structured-output', 'file-input'],
      contextWindow: 204800,
      inputModalities: ['text'],
      maxOutputTokens: 131072,
      openWeights: true,
      outputModalities: ['text'],
      pricing: {
        cacheRead: { currency: 'USD', perMillionTokens: 0.06 },
        cacheWrite: { currency: 'USD', perMillionTokens: 0.375 },
        input: { currency: 'USD', perMillionTokens: 0.3 },
        output: { currency: 'USD', perMillionTokens: 1.2 }
      }
    }
  ]
})
