import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'gisoo',
  name: 'Gisoo',
  availableInEditions: ['global'],
  baseUrl: 'https://gisoo.pro/api/v1',
  anthropic: 'https://gisoo.pro/api',
  website: {
    apiKey: 'https://gisoo.pro/app/api',
    docs: 'https://gisoo.pro/docs',
    models: 'https://gisoo.pro/docs/models',
    official: 'https://gisoo.pro'
  }
})
