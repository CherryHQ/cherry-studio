import { defineProvider } from './types'

// Astron Coding Plan is a subscription served from its OWN host and API key, over three protocols —
// never mix it with the pay-as-you-go `xfyun` host. Its served list is the plan's own model table
// (docs §4.1.3), which is NOT the MaaS set: it adds `auto` and omits `xdeepseekv3`.
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
    // Routing aliases — they resolve to whichever SKU the console has configured.
    { modelId: 'astron-code-latest', apiModelId: 'astron-code-latest', name: 'Astron Coding Plan', ownedBy: 'iflytek' },
    { modelId: 'auto', apiModelId: 'auto', name: 'Auto', ownedBy: 'iflytek' },
    // iFlytek's own models (see creators/iflytek.ts).
    { modelId: 'spark-x2-agent', apiModelId: 'xsparkx2agent' },
    { modelId: 'spark-x2', apiModelId: 'xsparkx2' },
    { modelId: 'spark-x2-flash', apiModelId: 'xsparkx2flash' },
    // Hosted open-weight models.
    { modelId: 'glm-5-2', apiModelId: 'xopglm52' },
    { modelId: 'glm-5-1', apiModelId: 'xopglm51' },
    { modelId: 'glm-5', apiModelId: 'xopglm5' },
    { modelId: 'glm-4-7-flash', apiModelId: 'xopglmv47flash' },
    { modelId: 'deepseek-v4-pro', apiModelId: 'xopdeepseekv4pro' },
    { modelId: 'deepseek-v4-flash', apiModelId: 'xopdeepseekv4flash' },
    { modelId: 'deepseek-v3-2', apiModelId: 'xopdeepseekv32' },
    { modelId: 'kimi-k2-7-code', apiModelId: 'xopkimi27code' },
    { modelId: 'kimi-k2-6', apiModelId: 'xopkimik26' },
    { modelId: 'kimi-k2-5', apiModelId: 'xopkimik25' },
    { modelId: 'minimax-m2-5', apiModelId: 'xminimaxm25' },
    { modelId: 'qwen3-5-397b-a17b', apiModelId: 'xopqwen35397b' },
    { modelId: 'qwen3-6-35b-a3b', apiModelId: 'xopqwen36v35b' },
    { modelId: 'qwen3-5-35b-a3b', apiModelId: 'xopqwen35v35b' },
    { modelId: 'qwen3-coder-next', apiModelId: 'xop3qwencodernext' }
  ]
})
