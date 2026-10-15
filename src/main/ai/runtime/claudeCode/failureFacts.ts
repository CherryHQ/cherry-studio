import { providerFailureFacts } from '@main/ai/errorReporting'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

import { isClaudeCodeProcessFailure, type ClaudeCodeProcessDiagnostics } from './processExitDiagnostics'
import { ClaudeCodeResultError } from './streamAdapter'

export function classifyClaudeFailure(
  error: unknown,
  options: { cancelled?: boolean; recovered?: boolean; process?: ClaudeCodeProcessDiagnostics } = {}
): FailureFacts {
  const facts: FailureFacts = {
    runtime: 'claude-code',
    source: 'sdk',
    kind: 'unknown',
    reason: 'execution_failed',
    outcome: options.recovered ? 'recovered' : 'failed'
  }
  if (options.cancelled || isCancellation(error))
    return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  if (error instanceof ClaudeCodeResultError) {
    if (['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'].includes(error.subtype)) {
      return { ...facts, kind: 'expected', reason: error.subtype }
    }
    const provider = providerFailureFacts(error)
    return {
      ...facts,
      ...provider,
      reason:
        provider?.reason ?? (error.subtype === 'success' ? (error.terminalReason ?? 'result_error') : error.subtype)
    }
  }
  if (isClaudeCodeProcessFailure(error, options.process)) {
    return { ...facts, kind: 'reliability', reason: options.process?.spawnFailed ? 'spawn_failed' : 'process_exit' }
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  return facts
}
