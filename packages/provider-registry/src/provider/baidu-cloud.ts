import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'baidu-cloud',
  name: 'Baidu Cloud',
  baseUrl: 'https://qianfan.baidubce.com/v2/',
  website: {
    apiKey: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    docs: 'https://cloud.baidu.com/doc/index.html',
    models: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Fm2vrveyu',
    official: 'https://cloud.baidu.com/'
  }
})
