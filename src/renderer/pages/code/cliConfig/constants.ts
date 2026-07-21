import type { EndpointType } from '@shared/data/types/model'

export const CODEX_RESPONSES_ENDPOINT = 'openai-responses'
export const CODEX_CHAT_ENDPOINT = 'openai-chat-completions'

export const GEMINI_AGGREGATOR_BASE_URLS: Record<string, string> = {
  aihubmix: 'https://aihubmix.com/gemini'
}

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
export const CHERRY_PROVIDER_PREFIX = 'cherry-'

export const OPEN_CODE_ENDPOINTS: readonly EndpointType[] = [
  'google-generate-content',
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]
