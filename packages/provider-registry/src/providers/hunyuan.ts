import { defineProvider } from './types'

export default defineProvider({
  id: 'hunyuan',
  name: 'hunyuan',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com',
      reasoningFormat: { type: 'enable-thinking' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
      docs: 'https://cloud.tencent.com/document/product/1729/111007',
      models: 'https://cloud.tencent.com/document/product/1729/104753',
      official: 'https://cloud.tencent.com/product/hunyuan'
    }
  }
})
