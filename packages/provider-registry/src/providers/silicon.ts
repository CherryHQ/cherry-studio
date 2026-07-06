import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'silicon',
  name: 'Silicon',
  baseUrl: 'https://api.siliconflow.cn/v1',
  anthropic: 'https://api.siliconflow.cn',
  website: {
    apiKey: 'https://cloud.siliconflow.cn/',
    docs: 'https://docs.siliconflow.cn/',
    models: 'https://cloud.siliconflow.cn/models',
    official: 'https://www.siliconflow.cn'
  },
  modelsDevProvider: 'siliconflow'
})
