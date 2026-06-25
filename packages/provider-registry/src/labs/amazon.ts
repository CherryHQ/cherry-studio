import { defineLab } from './types'

export default defineLab({
  id: 'amazon',
  name: 'Amazon',
  modelsDevProviders: ['amazon-bedrock'],
  families: ['nova', 'titan'],
  idPrefixes: ['nova', 'titan']
})
