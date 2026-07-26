import { defineCreator } from './types'

export default defineCreator({
  id: 'perplexity',
  name: 'Perplexity',
  modelsDevProviders: ['perplexity'],
  idPrefixes: ['sonar'],
  reasoningFamilies: [
    { pattern: '^sonar-reasoning|^sonar-deep-research', effort: ['low', 'medium', 'high'] },
    // Membership profile (no knobs): unanchored superset of the effort rule.
    { pattern: 'sonar-deep-research' }
  ],
  webSearch: ['sonar']
})
