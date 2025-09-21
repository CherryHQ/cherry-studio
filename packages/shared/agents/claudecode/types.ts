import type { SDKMessage } from '@anthropic-ai/claude-code'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'

export type ClaudeCodeRawValue =
  | {
      type: string
      session_id: string
      slash_commands: string[]
      tools: string[]
      raw: Extract<SDKMessage, { type: 'system' }>
    }
  | ContentBlockParam
