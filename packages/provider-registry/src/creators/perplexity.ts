import { defineCreator } from './types'

export default defineCreator({
  id: 'perplexity',
  name: 'Perplexity',
  modelsDevProviders: ['perplexity'],
  idPrefixes: ['sonar'],
  reasoningMembership: ['sonar-deep-research'],
  reasoningFamilies: [{ pattern: '^sonar-reasoning|^sonar-deep-research', effort: ['low', 'medium', 'high'] }],
  webSearch: ['sonar']
})
