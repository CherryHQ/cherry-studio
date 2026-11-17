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

export function classifyAiSdkFailure(error: unknown, depth = 0): FailureFacts {
  const facts: FailureFacts = {
    runtime: 'ai-sdk',
    source: 'application',
    kind: 'unknown',
    reason: 'execution_failed',
    outcome: 'failed'
  }
  if (isCancellation(error)) return { ...facts, kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  if (RetryError.isInstance(error) && depth < 3) return classifyAiSdkFailure(error.lastError, depth + 1)
  if (error instanceof ProviderTransportError) {
    return { ...facts, source: 'environment', kind: 'expected', reason: error.reason }
  }
  if (APICallError.isInstance(error)) {
    return { ...facts, source: 'provider', ...providerFailureFacts(error) }
  }
  if (LoadAPIKeyError.isInstance(error)) return { ...facts, source: 'environment', kind: 'expected', reason: 'auth' }
  if (
    error instanceof ToolLoopTerminalError ||
    InvalidToolInputError.isInstance(error) ||
    NoSuchToolError.isInstance(error)
  ) {
    return { ...facts, source: 'tool', kind: 'expected', reason: 'tool_execution_rejected' }
  }
  if (
    InvalidResponseDataError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    TypeValidationError.isInstance(error)
  ) {
    return { ...facts, source: 'provider', kind: 'reliability', reason: 'invalid_response' }
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return { ...facts, kind: 'defect', reason: 'runtime_exception' }
  }
  return facts
}
