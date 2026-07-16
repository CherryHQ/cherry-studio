import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'radeon-cloud',
  name: 'AMD GPU Cloud',
  baseUrl: 'https://developer.amd.com.cn/radeon/v1',
  website: {
    apiKey: 'https://developer.amd.com.cn/radeon/modelapis',
    docs: 'https://developer.amd.com.cn/radeon/',
    models: 'https://developer.amd.com.cn/radeon/',
    official: 'https://developer.amd.com.cn/radeon/'
  }
})
