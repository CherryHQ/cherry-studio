import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'mistral',
  name: 'Mistral AI',
  fetchModels: openaiCompatible('mistral', 'MISTRAL_API_KEY'),
  modelsDevProviders: ['mistral'],
  reasoningFamilies: [{ pattern: '^mistral-small-2603', effort: ['none', 'high'] }],
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
