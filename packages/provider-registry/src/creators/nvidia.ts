import { defineCreator } from './types'

export default defineCreator({
  id: 'nvidia',
  name: 'NVIDIA',
  modelsDevProviders: ['nvidia'],
  families: ['nemotron'],
  idPrefixes: ['nemotron', 'nemoretriever', 'parakeet', 'llama-3-1-nemotron'],
  models: [
    {
      id: 'nemotron-3-5-lightning',
      name: 'Nemotron 3.5 Lightning 30B',
      family: 'nemotron',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 1_000_000,
      maxOutputTokens: 131_072,
      openWeights: true,
      pricing: undefined,
      reasoning: { controls: [{ kind: 'budget', min: 1, max: 32_768 }, { kind: 'toggle' }] }
    }
  ],
  // The version segment is optional and open-ended (`nemotron-nano`, `nemotron-3-nano`,
  // `nemotron-3-5-lightning`), so a new release line only needs its tier word added here.
  reasoningFamilies: [
    { pattern: '(?:llama-3-1-)?nemotron-(?:\\d+(?:-\\d+)*-)?(?:nano|super|ultra|lightning)' },
    { pattern: '^muse-glimmer' }
  ]
})
