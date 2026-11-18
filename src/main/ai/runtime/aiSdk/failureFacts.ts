import {
  APICallError,
  InvalidResponseDataError,
  InvalidToolInputError,
  JSONParseError,
  LoadAPIKeyError,
  NoSuchToolError,
  RetryError,
  TypeValidationError
} from 'ai'

import { providerFailureFacts } from '@main/ai/errorReporting'
import { ProviderTransportError } from '@main/ai/utils/customFetch'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

import { ToolLoopTerminalError } from './loop/toolLoopTermination'

export function classifyAiSdkFailure(cause: unknown, depth = 0): FailureFacts {
  const facts: FailureFacts = {
    runtime: 'ai-sdk',
    source: 'application',
    kind: 'unknown',
    reason: 'execution_failed',
    outcome: 'failed'
  }
  if (isCancellation(cause)) return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  if (RetryError.isInstance(cause) && depth < 3) return classifyAiSdkFailure(cause.lastError, depth + 1)
  if (cause instanceof ProviderTransportError) {
    return { ...facts, source: 'environment', kind: 'expected', reason: cause.reason }
  }
  if (APICallError.isInstance(cause)) {
    return { ...facts, source: 'provider', ...providerFailureFacts(cause) }
  }
  if (LoadAPIKeyError.isInstance(cause)) return { ...facts, source: 'environment', kind: 'expected', reason: 'auth' }
  if (
    cause instanceof ToolLoopTerminalError ||
    InvalidToolInputError.isInstance(cause) ||
    NoSuchToolError.isInstance(cause)
  ) {
    return { ...facts, source: 'tool', kind: 'expected', reason: 'tool_execution_rejected' }
  }
  if (
    InvalidResponseDataError.isInstance(cause) ||
    JSONParseError.isInstance(cause) ||
    TypeValidationError.isInstance(cause)
  ) {
    return { ...facts, source: 'provider', kind: 'reliability', reason: 'invalid_response' }
  }
  if (cause instanceof TypeError || cause instanceof ReferenceError || cause instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  return facts
}
