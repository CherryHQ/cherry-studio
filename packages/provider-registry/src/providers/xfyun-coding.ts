import { defineProvider } from './types'
import { XFYUN_MODEL_OVERRIDES } from './xfyun'

// Astron Coding Plan is a subscription served from its OWN host and API key, over three protocols —
// never mix it with the pay-as-you-go `xfyun` host. `astron-code-latest` is the plan's routing alias:
// it resolves to whichever SKU the console has configured.
export default defineProvider({
  id: 'xfyun-coding',
  name: 'iFlytek Astron Coding Plan',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2'
    },
    // Responses lives on `/v1`, not the `/v2` chat host (Codex `wire_api = "responses"`).
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v1',
      reasoningFormat: { type: 'openai-responses' }
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://training.xfyun.cn/astronCodingPlan',
      docs: 'https://www.xfyun.cn/doc/spark/CodingPlan.html',
      models: 'https://www.xfyun.cn/doc/spark/CodingPlan.html',
      official: 'https://training.xfyun.cn'
    }
  },
  overrides: [
    { modelId: 'astron-code-latest', apiModelId: 'astron-code-latest', name: 'Astron Coding Plan', ownedBy: 'iflytek' },
    ...XFYUN_MODEL_OVERRIDES
  ]
})
