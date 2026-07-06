import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'baichuan',
  name: 'BAICHUAN AI',
  baseUrl: 'https://api.baichuan-ai.com',
  website: {
    apiKey: 'https://platform.baichuan-ai.com/console/apikey',
    docs: 'https://platform.baichuan-ai.com/docs',
    models: 'https://platform.baichuan-ai.com/prices',
    official: 'https://www.baichuan-ai.com/'
  },
  apiFeatures: {
    arrayContent: false
  }
})
