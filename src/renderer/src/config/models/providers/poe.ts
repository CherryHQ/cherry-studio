import type { Model } from '@renderer/types'

export const poeModels: Model[] = [
  { id: 'Claude-Opus-4.6', name: 'Claude Opus 4.6', provider: 'poe', group: 'Anthropic' },
  { id: 'Claude-Sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'poe', group: 'Anthropic' },
  { id: 'Claude-Haiku-4.5', name: 'Claude Haiku 4.5', provider: 'poe', group: 'Anthropic' },
  { id: 'GPT-5.4', name: 'GPT 5.4', provider: 'poe', group: 'OpenAI' },
  { id: 'GPT-5.3-Codex', name: 'GPT 5.3 Codex', provider: 'poe', group: 'OpenAI' },
  { id: 'GPT-5.2', name: 'GPT 5.2', provider: 'poe', group: 'OpenAI' },
  { id: 'GPT-5.2-Codex', name: 'GPT 5.2 Codex', provider: 'poe', group: 'OpenAI' },
  { id: 'GPT-5.1', name: 'GPT 5.1', provider: 'poe', group: 'OpenAI' },
  { id: 'Gemini-3.1-Pro', name: 'Gemini 3.1 Pro', provider: 'poe', group: 'Google' },
  { id: 'Grok-4', name: 'Grok 4', provider: 'poe', group: 'xAI' },
  { id: 'DeepSeek-R1', name: 'DeepSeek R1', provider: 'poe', group: 'DeepSeek' },
  { id: 'Kimi-K2.5', name: 'Kimi K2.5', provider: 'poe', group: 'Kimi' },
  { id: 'Kimi-K2-Thinking', name: 'Kimi K2 Thinking', provider: 'poe', group: 'Kimi' }
]
