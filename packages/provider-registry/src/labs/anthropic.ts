import { anthropicModels } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'anthropic',
  name: 'Anthropic',
  fetchModels: anthropicModels(),
  modelsDevProviders: ['anthropic'],
  idPrefixes: ['claude'],
  webSearch: [
    'claude-opus-4',
    'claude-sonnet-4',
    'claude-haiku-4',
    'claude-3-5-haiku',
    'claude-3-5-sonnet',
    'claude-3-7-sonnet'
  ]
})
