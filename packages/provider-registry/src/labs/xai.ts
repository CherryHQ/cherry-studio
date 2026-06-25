import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'xai',
  name: 'xAI',
  fetchModels: openaiCompatible('grok', 'XAI_API_KEY'),
  modelsDevProviders: ['xai'],
  idPrefixes: ['grok']
})
