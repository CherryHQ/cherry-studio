import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'demonroute',
  name: 'DemonRoute',
  availableInEditions: ['global'],
  baseUrl: 'https://api.demonroute.com/v1',
  website: {
    apiKey: 'https://demonroute.com/',
    docs: 'https://demonroute.com/integrations',
    models: 'https://demonroute.com/models',
    official: 'https://demonroute.com/'
  }
})
