import type { Model } from '@renderer/types'

export const cerebrasModels: Model[] = [
  {
    id: 'gpt-oss-120b',
    name: 'GPT oss 120B',
    provider: 'cerebras',
    group: 'openai'
  },
  {
    id: 'zai-glm-4.6',
    name: 'GLM 4.6',
    provider: 'cerebras',
    group: 'zai'
  },
  {
    id: 'qwen-3-235b-a22b-instruct-2507',
    name: 'Qwen 3 235B A22B Instruct',
    provider: 'cerebras',
    group: 'qwen'
  }
]
