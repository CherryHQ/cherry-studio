import type { Model } from '@renderer/types'

export const cephalonModels: Model[] = [
  {
    id: 'DeepSeek-R1',
    provider: 'cephalon',
    name: 'DeepSeek-R1满血版',
    capabilities: [{ type: 'reasoning' }],
    group: 'DeepSeek'
  }
]
