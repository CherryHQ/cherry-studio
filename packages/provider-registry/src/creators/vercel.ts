import { defineCreator } from './types'

export default defineCreator({
  id: 'vercel',
  name: 'Vercel',
  modelsDevProviders: ['vercel'],
  idPrefixes: ['v0'],
  reasoningFamilies: [{ pattern: '^muse-spark' }, { pattern: '^interfaze' }, { pattern: '^laguna-s' }]
})
