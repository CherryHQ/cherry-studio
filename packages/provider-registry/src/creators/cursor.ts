import { type CreatorModel, defineCreator } from './types'

const composer = {
  family: 'composer',
  contextWindow: 200000,
  capabilities: ['function-call'],
  inputModalities: ['text'],
  outputModalities: ['text'],
  openWeights: false
} satisfies Omit<CreatorModel, 'id'>

export default defineCreator({
  id: 'cursor',
  name: 'Cursor',
  models: [
    {
      ...composer,
      id: 'composer-2-5',
      name: 'Composer 2.5',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
        output: { currency: 'USD', perMillionTokens: 2.5 }
      }
    },
    {
      ...composer,
      id: 'composer-2-5-fast',
      name: 'Composer 2.5 Fast',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 3 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        output: { currency: 'USD', perMillionTokens: 15 }
      }
    }
  ]
})
