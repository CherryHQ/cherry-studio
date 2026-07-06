import { defineCreator } from './types'

export default defineCreator({
  id: 'amazon',
  name: 'Amazon',
  modelsDevProviders: ['amazon-bedrock'],
  families: ['nova', 'titan'],
  idPrefixes: ['nova', 'titan']
})
