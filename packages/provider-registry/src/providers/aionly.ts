import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'aionly',
  name: 'AIOnly',
  baseUrl: 'https://api.aiionly.com',
  website: {
    apiKey: 'https://maas.aiionly.com/keyApi',
    docs: 'https://maas.aiionly.com/document',
    models: 'https://maas.aiionly.com',
    official: 'https://www.aiionly.com'
  }
})
