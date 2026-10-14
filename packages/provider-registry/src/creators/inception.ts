import { defineCreator } from './types'

export default defineCreator({
  id: 'inception',
  name: 'Inception (Mercury)',
  modelsDevProviders: ['inception'],
  families: ['mercury'],
  idPrefixes: ['mercury'],
  reasoningFamilies: [{ pattern: '^mercury-2' }]
})
