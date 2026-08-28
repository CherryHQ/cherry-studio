import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'mistral',
  name: 'Mistral AI',
  fetchModels: openaiCompatible('mistral', 'MISTRAL_API_KEY'),
  modelsDevProviders: ['mistral'],
  reasoningFamilies: [
    { pattern: '^mistral-small-2603', effort: ['none', 'high'] },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: 'magistral' },
    { pattern: 'mistral-small-2603' },
    { pattern: '^mistral-(?:small|medium)(?!.*instruct)' }
  ],
  idPrefixes: [
    'mistral',
    'ministral',
    'codestral',
    'devstral',
    'magistral',
    'voxtral',
    'pixtral',
    'open-mistral',
    'open-mixtral'
  ]
})
