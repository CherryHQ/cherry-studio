import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'cephalon',
  name: 'Cephalon',
  baseUrl: 'https://cephalon.cloud/user-center/v1/model',
  website: {
    apiKey: 'https://cephalon.cloud/api',
    docs: 'https://cephalon.cloud/',
    models: 'https://cephalon.cloud/model',
    official: 'https://cephalon.cloud/'
  },
  apiFeatures: {
    arrayContent: false
  }
})
