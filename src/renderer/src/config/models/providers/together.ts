import type { Model } from '@renderer/types'

export const togetherModels: Model[] = [
  {
    id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
    provider: 'together',
    name: 'Llama-3.2-11B-Vision',
    group: 'Llama-3.2'
  },
  {
    id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    provider: 'together',
    name: 'Llama-3.2-90B-Vision',
    group: 'Llama-3.2'
  },
  {
    id: 'google/gemma-2-27b-it',
    provider: 'together',
    name: 'gemma-2-27b-it',
    group: 'Gemma'
  },
  {
    id: 'google/gemma-2-9b-it',
    provider: 'together',
    name: 'gemma-2-9b-it',
    group: 'Gemma'
  }
]
