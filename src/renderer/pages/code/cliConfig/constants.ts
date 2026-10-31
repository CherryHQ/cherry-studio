import type { EndpointType } from '@shared/data/types/model'
import { CHERRY_PROVIDER_KEY_PREFIX } from '@shared/utils/cliConfig'

export const CODEX_RESPONSES_ENDPOINT = 'openai-responses'
export const CODEX_CHAT_ENDPOINT = 'openai-chat-completions'

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
export const CHERRY_PROVIDER_PREFIX = CHERRY_PROVIDER_KEY_PREFIX

export const OPEN_CODE_ENDPOINTS: readonly EndpointType[] = [
  'google-generate-content',
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]

export const PI_ENDPOINTS: readonly EndpointType[] = [
  'google-generate-content',
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]

export const HERMES_ENDPOINTS: readonly EndpointType[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]

export const MINIMAX_ENDPOINTS: readonly EndpointType[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]

export const COMMANDCODE_ENDPOINTS: readonly EndpointType[] = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]
