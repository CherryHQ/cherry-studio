import { defineCreator } from './types'

export default defineCreator({
  id: 'vercel',
  name: 'Vercel',
  modelsDevProviders: ['vercel'],
  idPrefixes: ['v0'],
  reasoningFamilies: [
    { pattern: '^muse-spark' },
    { pattern: '^interfaze' },
    { pattern: '^laguna-s' },
    { pattern: '^arrow-2', effort: ['low', 'medium', 'high', 'xhigh'] },
    { pattern: '^ember-1', effort: ['low', 'medium', 'high'], toggle: true },
    { pattern: '^fugu', effort: ['high', 'xhigh'] },
    { pattern: '^namazu', effort: ['none', 'low', 'medium', 'high'] },
    { pattern: '^pixel-canary', effort: ['none', 'low', 'medium', 'xhigh'] }
  ]
})
