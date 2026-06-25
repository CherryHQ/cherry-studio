import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'mistral',
  name: 'Mistral AI',
  fetchModels: openaiCompatible('mistral', 'MISTRAL_API_KEY'),
  modelsDevProviders: ['mistral'],
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
