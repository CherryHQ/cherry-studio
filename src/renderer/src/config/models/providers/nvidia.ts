import type { Model } from '@renderer/types'

export const nvidiaModels: Model[] = [
  {
    id: '01-ai/yi-large',
    provider: 'nvidia',
    name: 'yi-large',
    group: 'Yi'
  },
  {
    id: 'meta/llama-3.1-405b-instruct',
    provider: 'nvidia',
    name: 'llama-3.1-405b-instruct',
    group: 'llama-3.1'
  }
]
