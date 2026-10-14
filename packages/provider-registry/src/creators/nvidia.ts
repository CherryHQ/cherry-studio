import { defineCreator } from './types'

export default defineCreator({
  id: 'nvidia',
  name: 'NVIDIA',
  modelsDevProviders: ['nvidia'],
  families: ['nemotron'],
  idPrefixes: ['nemotron', 'nemoretriever', 'parakeet', 'llama-3-1-nemotron'],
  // The version segment is optional and open-ended (`nemotron-nano`, `nemotron-3-nano`,
  // `nemotron-3-5-lightning`), so a new release line only needs its tier word added here.
  reasoningFamilies: [
    { pattern: '(?:llama-3-1-)?nemotron-(?:\\d+(?:-\\d+)*-)?(?:nano|super|ultra|lightning)' },
    { pattern: '^muse-glimmer' }
  ]
})
