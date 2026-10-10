import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'acedatacloud',
  name: 'Ace Data Cloud',
  availableInEditions: ['global'],
  baseUrl: 'https://api.acedata.cloud/openai#',
  website: {
    apiKey: 'https://platform.acedata.cloud/console/applications',
    docs: 'https://platform.acedata.cloud/documents/openai-chat-completions',
    models: 'https://platform.acedata.cloud/models',
    official: 'https://acedata.cloud'
  }
})
