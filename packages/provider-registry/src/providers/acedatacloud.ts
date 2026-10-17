import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'acedatacloud',
  name: 'Ace Data Cloud',
  availableInEditions: ['global'],
  baseUrl: 'https://api.acedata.cloud/openai#',
  website: {
    apiKey:
      'https://platform.acedata.cloud/console/applications?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_api_key',
    docs: 'https://platform.acedata.cloud/documents/openai-chat-completions?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_docs',
    models:
      'https://platform.acedata.cloud/models?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_models',
    official:
      'https://acedata.cloud?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=cherrystudio_provider_website'
  }
})
