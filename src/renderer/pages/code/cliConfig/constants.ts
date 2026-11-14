import type { EndpointType } from '@shared/data/types/model'

export const CODEX_RESPONSES_ENDPOINT = 'openai-responses'
export const CODEX_CHAT_ENDPOINT = 'openai-chat-completions'

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
export const CHERRY_PROVIDER_PREFIX = 'cherry-'

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

// OMP is a fork of Pi and inherits its custom-provider schema, so it supports
// the same endpoint set. Aliased (not duplicated) so endpoint fixes stay in sync.
export const OMP_ENDPOINTS: readonly EndpointType[] = PI_ENDPOINTS

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
