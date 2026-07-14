import { defineCreator } from './types'

export default defineCreator({
  id: 'perplexity',
  name: 'Perplexity',
  modelsDevProviders: ['perplexity'],
  idPrefixes: ['sonar'],
  webSearch: ['sonar']
})
