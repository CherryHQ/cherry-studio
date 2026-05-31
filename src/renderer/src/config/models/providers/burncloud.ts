import type { Model } from '@renderer/types'

export const burncloudModels: Model[] = [
  { id: 'claude-opus-4-5-20251101', provider: 'burncloud', name: 'Claude 4.5 Opus', group: 'Claude 4.5' },
  { id: 'claude-sonnet-4-5-20250929', provider: 'burncloud', name: 'Claude 4.5 Sonnet', group: 'Claude 4.5' },
  { id: 'claude-haiku-4-5-20251001', provider: 'burncloud', name: 'Claude 4.5 Haiku', group: 'Claude 4.5' },

  { id: 'gpt-5', provider: 'burncloud', name: 'GPT 5', group: 'GPT 5' },
  { id: 'gpt-5.1', provider: 'burncloud', name: 'GPT 5.1', group: 'GPT 5.1' },

  { id: 'gemini-2.5-flash', provider: 'burncloud', name: 'Gemini 2.5 Flash', group: 'Gemini 2.5' },
  { id: 'gemini-2.5-flash-image', provider: 'burncloud', name: 'Gemini 2.5 Flash Image', group: 'Gemini 2.5' },
  { id: 'gemini-2.5-pro', provider: 'burncloud', name: 'Gemini 2.5 Pro', group: 'Gemini 2.5' },
  { id: 'gemini-3-pro-preview', provider: 'burncloud', name: 'Gemini 3 Pro Preview', group: 'Gemini 3' },

  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'burncloud', group: 'deepseek-ai' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'burncloud', group: 'deepseek-ai' }
]
