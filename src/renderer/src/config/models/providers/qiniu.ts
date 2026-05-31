import type { Model } from '@renderer/types'

export const qiniuModels: Model[] = [
  {
    id: 'deepseek-r1',
    provider: 'qiniu',
    name: 'DeepSeek R1',
    group: 'DeepSeek'
  },
  {
    id: 'deepseek-r1-search',
    provider: 'qiniu',
    name: 'DeepSeek R1 Search',
    group: 'DeepSeek'
  },
  {
    id: 'deepseek-r1-32b',
    provider: 'qiniu',
    name: 'DeepSeek R1 32B',
    group: 'DeepSeek'
  },
  {
    id: 'deepseek-v3',
    provider: 'qiniu',
    name: 'DeepSeek V3',
    group: 'DeepSeek'
  },
  {
    id: 'deepseek-v3-search',
    provider: 'qiniu',
    name: 'DeepSeek V3 Search',
    group: 'DeepSeek'
  },
  {
    id: 'deepseek-v3-tool',
    provider: 'qiniu',
    name: 'DeepSeek V3 Tool',
    group: 'DeepSeek'
  },
  {
    id: 'qwq-32b',
    provider: 'qiniu',
    name: 'QWQ 32B',
    group: 'Qwen'
  },
  {
    id: 'qwen2.5-72b-instruct',
    provider: 'qiniu',
    name: 'Qwen2.5 72B Instruct',
    group: 'Qwen'
  }
]
