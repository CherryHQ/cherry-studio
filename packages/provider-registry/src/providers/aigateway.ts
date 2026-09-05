import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'aigateway',
  name: 'AIgateway',
  availableInEditions: ['global'],
  baseUrl: 'https://api.aigateway.sh/v1',
  website: {
    apiKey: 'https://aigateway.sh/dashboard/keys',
    docs: 'https://aigateway.sh/docs',
    models: 'https://aigateway.sh/models',
    official: 'https://aigateway.sh'
  },
  modelsDevProvider: 'aigateway'
})
