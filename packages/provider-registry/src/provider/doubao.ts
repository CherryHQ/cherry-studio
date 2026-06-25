import { defineProvider } from './types'

export default defineProvider({
  id: 'doubao',
  name: 'doubao',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/'
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.volcengine.com/experience/ark',
      docs: 'https://www.volcengine.com/docs/82379/1182403',
      models: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint',
      official: 'https://console.volcengine.com/ark/'
    }
  }
})
