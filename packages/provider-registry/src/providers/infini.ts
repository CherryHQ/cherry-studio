import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'infini',
  name: 'Infini',
  baseUrl: 'https://cloud.infini-ai.com/maas',
  website: {
    apiKey: 'https://cloud.infini-ai.com/iam/secret/key',
    docs: 'https://docs.infini-ai.com/gen-studio/api/maas.html',
    models: 'https://cloud.infini-ai.com/genstudio/model',
    official: 'https://cloud.infini-ai.com/'
  }
})
