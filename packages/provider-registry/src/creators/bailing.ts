import { defineCreator } from './types'

export default defineCreator({
  id: 'bailing',
  name: 'Ant Group (Ling/Ring)',
  modelsDevProviders: ['bailing'],
  families: ['ling', 'ring'],
  idPrefixes: ['ling', 'ring', 'bailing'],
  reasoningFamilies: [
    { pattern: 'ring-(?:1t|mini|flash)' },
    { pattern: '^inkling' },
    { pattern: '^ling-3-0-flash-fin$', toggle: true }
  ]
})
