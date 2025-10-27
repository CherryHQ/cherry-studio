// ported from https://github.com/ben-vargas/ai-sdk-provider-claude-code/blob/main/src/map-claude-code-finish-reason.ts#L22
import type { LanguageModelV2FinishReason } from '@ai-sdk/provider'

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: 'length'
 * ```
 *
 * @remarks
 * Mappings:
 * - 'success' -> 'stop' (normal completion)
 * - 'error_max_turns' -> 'length' (hit turn limit)
 * - 'error_during_execution' -> 'error' (execution error)
 * - default -> 'stop' (unknown subtypes treated as normal completion)
 */
export function mapClaudeCodeFinishReason(subtype?: string): LanguageModelV2FinishReason {
  switch (subtype) {
    case 'success':
      return 'stop'
    case 'error_max_turns':
      return 'length'
    case 'error_during_execution':
      return 'error'
    default:
      return 'stop'
  }
}
