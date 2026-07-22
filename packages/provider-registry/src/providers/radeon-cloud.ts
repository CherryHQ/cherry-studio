import { openaiCompatible } from './types'

const TOKEN_FACTORY_URL = 'https://developer.amd.com.cn/radeon/tokenfactory?source=cherry-studio'

export default openaiCompatible({
  id: 'radeon-cloud',
  name: 'AMD GPU Cloud',
  baseUrl: 'https://developer.amd.com.cn/radeon/v1',
  website: {
    apiKey: TOKEN_FACTORY_URL,
    docs: 'https://developer.amd.com.cn/radeon/',
    models: TOKEN_FACTORY_URL,
    official: 'https://developer.amd.com.cn/radeon/'
  }
})
