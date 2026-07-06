import { anthropicModels } from './_api'
import { defineCreator } from './types'

export default defineCreator({
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
