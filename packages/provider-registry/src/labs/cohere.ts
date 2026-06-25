import { cohereModels } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'cohere',
  name: 'Cohere',
  fetchModels: cohereModels(),
  modelsDevProviders: ['cohere'],
  idPrefixes: ['command', 'c4ai']
})
