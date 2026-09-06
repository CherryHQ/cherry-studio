import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'ocoolai',
  name: 'ocoolAI',
  baseUrl: 'https://api.ocoolai.com',
  modelListApi: { type: 'new-api', supportsPricing: true },
  website: {
    apiKey: 'https://one.ocoolai.com/token',
    docs: 'https://docs.ocoolai.com/',
    models: 'https://api.ocoolai.com/info/models/',
    official: 'https://one.ocoolai.com/'
  }
})
