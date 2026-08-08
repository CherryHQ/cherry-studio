import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'edenai',
  name: 'Eden AI',
  baseUrl: 'https://api.edenai.run/v3/',
  website: {
    apiKey: 'https://app.edenai.run/admin/account/settings',
    docs: 'https://docs.edenai.co',
    models: 'https://www.edenai.co/product/models',
    official: 'https://www.edenai.co'
  }
})
