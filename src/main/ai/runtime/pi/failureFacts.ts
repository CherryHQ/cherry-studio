import { providerFailureFacts } from '@main/ai/errorReporting'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

export function classifyPiFailure(
  cause: unknown,
  options: { cancelled?: boolean; stopReason?: string; returnedFailure?: boolean; recovered?: boolean } = {}
): FailureFacts {
  const facts: FailureFacts = {
    runtime: 'pi',
    source: 'sdk',
    kind: 'unknown',
    reason: 'execution_failed',
    outcome: options.recovered ? 'recovered' : 'failed'
  }
  if (options.cancelled || isCancellation(cause) || options.stopReason === 'aborted') {
    return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  }
  if (cause instanceof TypeError || cause instanceof ReferenceError || cause instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  if (options.stopReason === 'length') return { ...facts, kind: 'expected', reason: 'output_limit' }
  // Text classification is confined to SDK-returned failures, not arbitrary application exceptions.
  const provider =
    options.returnedFailure || (cause && typeof cause === 'object' && 'statusCode' in cause)
      ? providerFailureFacts(cause)
      : undefined
  return { ...facts, ...provider }
}
