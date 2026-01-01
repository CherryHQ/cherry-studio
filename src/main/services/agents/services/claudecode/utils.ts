// ported from https://github.com/ben-vargas/ai-sdk-provider-claude-code/blob/main/src/map-claude-code-finish-reason.ts#L22
import type { JSONObject } from '@ai-sdk/provider'
import type { BetaStopReason } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { FinishReason, LanguageModelUsage } from 'ai'

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: 'length'
 * ```
 **/
export function mapClaudeCodeFinishReason(subtype?: string): FinishReason {
  switch (subtype) {
    case 'success':
      return 'stop'
    case 'error_max_turns':
      return 'length'
    case 'error_during_execution':
      return 'error'
    case undefined:
      return 'stop'
    default:
      // Unknown subtypes mapped to 'other' to distinguish from genuine completion
      return 'other'
  }
}

/**
 * Maps Anthropic stop reasons to the AiSDK equivalents so higher level
 * consumers can treat completion states uniformly across providers.
 */
const finishReasonMapping: Record<BetaStopReason, FinishReason> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool-calls',
  pause_turn: 'other',
  refusal: 'content-filter'
}

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: 'length'
 * ```
 **/
export function mapClaudeCodeStopReason(claudeStopReason: BetaStopReason | null): FinishReason {
  if (claudeStopReason === null) {
    return 'stop'
  }
  return finishReasonMapping[claudeStopReason] || 'other'
}

type ClaudeCodeUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Converts Claude Code SDK usage to AI SDK v6 stable usage format.
 *
 * Maps Claude's flat token counts to the nested structure required by AI SDK v6:
 * - `cache_creation_input_tokens` → `inputTokens.cacheWrite`
 * - `cache_read_input_tokens` → `inputTokens.cacheRead`
 * - `input_tokens` → `inputTokens.noCache`
 * - `inputTokens.total` = sum of all input tokens
 * - `output_tokens` → `outputTokens.total`
 *
 * @param usage - Raw usage data from Claude Code SDK
 * @returns Formatted usage object for AI SDK v6
 */
export function convertClaudeCodeUsage(usage: ClaudeCodeUsage): LanguageModelUsage {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined
    },
    raw: usage as JSONObject
  }
}
