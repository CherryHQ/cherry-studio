import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'xirang',
  name: 'Xirang',
  baseUrl: 'https://wishub-x1.ctyun.cn',
  website: {
    apiKey: 'https://huiju.ctyun.cn/service/serviceGroup',
    docs: 'https://www.ctyun.cn/products/ctxirang',
    models: 'https://huiju.ctyun.cn/modelSquare/',
    official: 'https://www.ctyun.cn'
  },
  apiFeatures: {
    arrayContent: false
  }
})
