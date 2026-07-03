import type { EndpointType } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

export const CODEX_RESPONSES_ENDPOINT = 'openai-responses'
export const CODEX_CHAT_ENDPOINT = 'openai-chat-completions'

export const FILE_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.OPEN_CODE,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

export const GEMINI_AGGREGATOR_BASE_URLS: Record<string, string> = {
  aihubmix: 'https://aihubmix.com/gemini'
}

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
export const CHERRY_PROVIDER_PREFIX = 'cherry-'
export const CHERRY_PREFIX = 'cherry-'

export const OPEN_CODE_ENDPOINTS: readonly EndpointType[] = [
  'google-generate-content',
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions'
]
