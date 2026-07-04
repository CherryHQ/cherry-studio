import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'modelscope',
  name: 'ModelScope',
  baseUrl: 'https://api-inference.modelscope.cn/v1/',
  anthropic: 'https://api-inference.modelscope.cn',
  website: {
    apiKey: 'https://modelscope.cn/my/myaccesstoken',
    docs: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
    models: 'https://modelscope.cn/models',
    official: 'https://modelscope.cn'
  },
  modelsDevProvider: 'modelscope'
})
