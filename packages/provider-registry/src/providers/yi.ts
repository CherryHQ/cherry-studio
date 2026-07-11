import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'yi',
  name: 'Yi',
  baseUrl: 'https://api.lingyiwanwu.com',
  website: {
    apiKey: 'https://platform.lingyiwanwu.com/apikeys',
    docs: 'https://platform.lingyiwanwu.com/docs',
    models: 'https://platform.lingyiwanwu.com/docs',
    official: 'https://platform.lingyiwanwu.com/'
  }
})
