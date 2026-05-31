import type { Model } from '@renderer/types'

export const openaiModels: Model[] = [
  { id: 'gpt-5.4', provider: 'openai', name: ' GPT 5.4', group: 'gpt-5.4' },
  { id: 'gpt-5.4-pro', provider: 'openai', name: ' GPT 5.4 Pro', group: 'gpt-5.4' },
  { id: 'gpt-5.2', provider: 'openai', name: ' GPT 5.2', group: 'gpt-5.2' },
  { id: 'gpt-5.2-pro', provider: 'openai', name: ' GPT 5.2 Pro', group: 'gpt-5.2' },
  { id: 'gpt-5.1', provider: 'openai', name: ' GPT 5.1', group: 'gpt-5.1' },
  { id: 'gpt-5', provider: 'openai', name: ' GPT 5', group: 'gpt-5' },
  { id: 'gpt-5-pro', provider: 'openai', name: ' GPT 5 Pro', group: 'gpt-5' },
  { id: 'gpt-5-chat', provider: 'openai', name: ' GPT 5 Chat', group: 'gpt-5' },
  { id: 'gpt-image-1', provider: 'openai', name: ' GPT Image 1', group: 'gpt-image' }
]
