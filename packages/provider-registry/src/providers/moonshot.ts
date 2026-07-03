import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'moonshot',
  name: 'Moonshot AI',
  baseUrl: 'https://api.moonshot.cn',
  anthropic: 'https://api.moonshot.cn/anthropic',
  website: {
    apiKey: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs/',
    models: 'https://platform.moonshot.cn/docs/',
    official: 'https://www.moonshot.cn/'
  }
})
