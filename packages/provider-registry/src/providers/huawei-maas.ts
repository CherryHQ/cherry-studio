import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'huawei-maas',
  name: 'Huawei Cloud MaaS',
  baseUrl: 'https://api.modelarts-maas.com/openai/v1',
  anthropic: 'https://api.modelarts-maas.com/anthropic/v1',
  website: {
    apiKey: 'https://console.huaweicloud.com/modelarts/#/model-studio/homepage',
    docs: 'https://support.huaweicloud.com/api-maas/api-maas-0002.html',
    models: 'https://support.huaweicloud.com/model-call-maas/model-call-021.html',
    official: 'https://www.huaweicloud.com/product/modelarts/studio.html'
  }
})
