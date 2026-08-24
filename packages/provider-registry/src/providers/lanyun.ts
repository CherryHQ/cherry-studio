import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'lanyun',
  name: 'LANYUN',
  baseUrl: 'https://maas-api.lanyun.net',
  website: {
    apiKey: 'https://maas.lanyun.net/#/system/apiKey',
    docs: 'https://archive.lanyun.net/#/maas/',
    models: 'https://maas.lanyun.net/#/model/modelSquare',
    official: 'https://maas.lanyun.net'
  },
  overrides: [
    { modelId: 'deepseek-r1' },
    { apiModelId: 'deepseek-v3.1', modelId: 'deepseek-v3-1' },
    { apiModelId: '/maas/deepseek-ai/DeepSeek-V3.2', modelId: 'deepseek-v3-2' },
    { apiModelId: 'deepseek-v3.2-exp', modelId: 'deepseek-v3-2-exp' },
    { apiModelId: '/maas/zhipuai/GLM-4.7', modelId: 'glm-4-7' },
    { apiModelId: '/maas/zhipuai/GLM-5', modelId: 'glm-5' },
    { modelId: 'kimi-k2' },
    { apiModelId: 'MiniMax-M2.1', modelId: 'minimax-m2-1' },
    { apiModelId: '/maas/minimax/MiniMax-M2.5', modelId: 'minimax-m2-5' },
    { apiModelId: '/maas/qwen/Qwen2.5-72B-Instruct', modelId: 'qwen2-5-72b-instruct', modelVariants: ['72b'] },
    { apiModelId: '/maas/qwen/Qwen3-235B-A22B', modelId: 'qwen3-235b-a22b', modelVariants: ['235b'] },
    { apiModelId: 'qwen3-32b', modelId: 'qwen3-32b', modelVariants: ['32b'] },
    { apiModelId: '/maas/qwen/Qwen3-VL-32B-Instruct', modelId: 'qwen3-vl-32b-instruct', modelVariants: ['32b'] },
    { apiModelId: '/maas/qwen/QwQ-32B', modelId: 'qwq-32b', modelVariants: ['32b'] },
    { apiModelId: '/maas/jieyue/step-3.5-flash', modelId: 'step-3-5-flash' }
  ]
})
