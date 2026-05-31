import type { Model } from '@renderer/types'

export const openrouterModels: Model[] = [
  {
    id: 'google/gemini-2.5-flash-image-preview',
    provider: 'openrouter',
    name: 'Google: Gemini 2.5 Flash Image',
    group: 'google'
  },
  {
    id: 'google/gemini-2.5-flash-preview',
    provider: 'openrouter',
    name: 'Google: Gemini 2.5 Flash Preview',
    group: 'google'
  },
  {
    id: 'qwen/qwen-2.5-7b-instruct:free',
    provider: 'openrouter',
    name: 'Qwen: Qwen-2.5-7B Instruct',
    group: 'qwen'
  },
  {
    id: 'deepseek/deepseek-chat',
    provider: 'openrouter',
    name: 'DeepSeek: V3',
    group: 'deepseek'
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    provider: 'openrouter',
    name: 'Mistral: Mistral 7B Instruct',
    group: 'mistralai'
  }
]
