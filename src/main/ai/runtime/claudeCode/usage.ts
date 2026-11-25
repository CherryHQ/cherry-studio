import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

import type { MessageStats } from '@shared/data/types/message'

type ClaudeTokenCounts = Pick<
  SDKResultMessage['usage'],
  'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'
>

export function claudeMessageStats(usage: ClaudeTokenCounts, reasoningTokens: number | undefined): MessageStats {
  const noCacheTokens = usage.input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const inputTokens = noCacheTokens + cacheWriteTokens + cacheReadTokens
  const outputTokens = usage.output_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens },
    ...(reasoningTokens !== undefined && { outputTokenDetails: { reasoningTokens } })
  }
}
