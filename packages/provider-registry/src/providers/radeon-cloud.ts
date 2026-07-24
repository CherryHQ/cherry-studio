import { openaiCompatible } from './types'

const TOKEN_FACTORY_URL = 'https://developer.amd.com.cn/radeon/tokenfactory?source=cherry-studio'

export default openaiCompatible({
  id: 'radeon-cloud',
  name: 'AMD GPU Cloud',
  baseUrl: 'https://developer.amd.com.cn/radeon/v1',
  website: {
    apiKey: TOKEN_FACTORY_URL,
    docs: 'https://developer.amd.com.cn/radeon/',
    models: TOKEN_FACTORY_URL,
    official: 'https://developer.amd.com.cn/radeon/'
  },
  overrides: [
    { modelId: 'qwen3-6-35b-a3b', apiModelId: 'Qwen3.6-35B-A3B' },
    { modelId: 'deepseek-v4-flash', apiModelId: 'DeepSeek-V4-Flash' },
    { modelId: 'deepseek-v4-pro', apiModelId: 'DeepSeek-V4-Pro' },
    { modelId: 'glm-5-1', apiModelId: 'GLM-5.1' },
    { modelId: 'glm-5-2', apiModelId: 'GLM-5.2' },
    { modelId: 'gpt-oss-120b', apiModelId: 'gpt-oss-120b' },
    { modelId: 'kimi-k2-6', apiModelId: 'Kimi-K2.6' }
  ]
})
