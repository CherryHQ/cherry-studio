import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'longcat',
  name: 'LongCat',
  baseUrl: 'https://api.longcat.chat/openai',
  anthropic: 'https://api.longcat.chat/anthropic',
  website: {
    apiKey: 'https://longcat.chat/platform/api_keys',
    docs: 'https://longcat.chat/platform/docs/zh/',
    models: 'https://longcat.chat/platform/docs/zh/APIDocs.html',
    official: 'https://longcat.chat'
  }
})
