import type { Model } from '@renderer/types'

export const ppioModels: Model[] = [
  {
    id: 'deepseek/deepseek-v3.2',
    provider: 'ppio',
    name: 'DeepSeek V3.2',
    group: 'deepseek'
  },
  {
    id: 'minimax/minimax-m2',
    provider: 'ppio',
    name: 'MiniMax M2',
    group: 'minimaxai'
  },
  {
    id: 'qwen/qwen3-235b-a22b-instruct-2507',
    provider: 'ppio',
    name: 'Qwen3-235b-a22b-instruct-2507',
    group: 'qwen'
  },
  {
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    provider: 'ppio',
    name: 'Qwen3-vl-235b-a22b-instruct',
    group: 'qwen'
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    provider: 'ppio',
    name: 'Qwen3 Embedding 8B',
    group: 'qwen'
  },
  {
    id: 'qwen/qwen3-reranker-8b',
    provider: 'ppio',
    name: 'Qwen3 Reranker 8B',
    group: 'qwen'
  }
]
