import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'trustedrouter',
  name: 'TrustedRouter',
  availableInEditions: ['global'],
  baseUrl: 'https://api.trustedrouter.com/v1',
  website: {
    apiKey: 'https://trustedrouter.com/console/api-keys',
    docs: 'https://trustedrouter.com/docs',
    models: 'https://trustedrouter.com/models',
    official: 'https://trustedrouter.com'
  },
  modelsDevProvider: 'trustedrouter'
})
