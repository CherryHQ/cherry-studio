import { defineCreator } from './types'

export default defineCreator({
  id: 'bailing',
  name: 'Ant Group (Ling/Ring)',
  modelsDevProviders: ['bailing'],
  families: ['ling', 'ring'],
  idPrefixes: ['ling', 'ring', 'bailing'],
  reasoningFamilies: [
    { pattern: 'ring-(?:1t|mini|flash)' },
    { pattern: '^ling-3[.-]0-flash' },
    { pattern: '^ling-3[.-]1-flash', effort: ['none', 'low', 'medium', 'high'] },
    { pattern: '^inkling' }
  ]
})
