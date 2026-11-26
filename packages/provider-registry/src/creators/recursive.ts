import { defineCreator } from './types'

export default defineCreator({
  id: 'recursive',
  name: 'Recursive',
  idPrefixes: ['flint'],
  reasoningFamilies: [{ pattern: '^flint-v1[.-]0$', effort: ['low', 'medium', 'high'] }],
  models: [
    {
      id: 'flint-v1-0',
      openWeights: true,
      capabilities: ['function-call', 'reasoning', 'structured-output']
    }
  ]
})
