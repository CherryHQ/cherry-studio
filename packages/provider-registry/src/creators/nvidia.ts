import { defineCreator } from './types'

export default defineCreator({
  id: 'nvidia',
  name: 'NVIDIA',
  modelsDevProviders: ['nvidia'],
  families: ['nemotron'],
  idPrefixes: ['nemotron', 'nemoretriever', 'parakeet', 'llama-3-1-nemotron'],
  reasoningFamilies: [{ pattern: '(?:llama-3-1-)?nemotron-(?:nano|super|ultra|3-(?:nano|super|ultra))' }]
})
