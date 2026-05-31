import type { Model } from '@renderer/types'

export const groqModels: Model[] = [
  {
    id: 'llama3-8b-8192',
    provider: 'groq',
    name: 'LLaMA3 8B',
    group: 'Llama3'
  },
  {
    id: 'llama3-70b-8192',
    provider: 'groq',
    name: 'LLaMA3 70B',
    group: 'Llama3'
  },
  {
    id: 'mistral-saba-24b',
    provider: 'groq',
    name: 'Mistral Saba 24B',
    group: 'Mistral'
  },
  {
    id: 'gemma-9b-it',
    provider: 'groq',
    name: 'Gemma 9B',
    group: 'Gemma'
  }
]
