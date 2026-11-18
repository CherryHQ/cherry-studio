import { providerFailureFacts } from '@main/ai/errorReporting'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

import { ClaudeCodeResultError } from './ClaudeRuntimeState'
import { isClaudeCodeProcessFailure, type ClaudeCodeProcessDiagnostics } from './processExitDiagnostics'

export function classifyClaudeFailure(
  cause: unknown,
  options: { cancelled?: boolean; recovered?: boolean; process?: ClaudeCodeProcessDiagnostics } = {}
): FailureFacts {
  const facts: FailureFacts = {
    runtime: 'claude-code',
    source: 'sdk',
    kind: 'unknown',
    reason: 'execution_failed',
    outcome: options.recovered ? 'recovered' : 'failed'
  }
  if (options.cancelled || isCancellation(cause))
    return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  if (cause instanceof ClaudeCodeResultError) {
    if (['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'].includes(cause.subtype)) {
      return { ...facts, kind: 'expected', reason: cause.subtype }
    }
    const provider = providerFailureFacts(cause)
    return {
      ...facts,
      ...provider,
      reason:
        provider?.reason ?? (cause.subtype === 'success' ? (cause.terminalReason ?? 'result_error') : cause.subtype)
    }
  }
  if (isClaudeCodeProcessFailure(cause, options.process)) {
    return { ...facts, kind: 'reliability', reason: options.process?.spawnFailed ? 'spawn_failed' : 'process_exit' }
  }
  if (cause instanceof TypeError || cause instanceof ReferenceError || cause instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  return facts
}
