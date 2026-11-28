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
import { ProviderContextOverflowError } from '@shared/ai/providerError'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

import { ToolLoopTerminalError } from './loop/toolLoopTermination'

const MISSING_FINISH_REASON_MESSAGE = 'Response stream ended without a finish reason.'

export class MissingFinishReasonError extends Error {
  readonly i18nKey = 'missing_finish_reason'

  constructor(
    cause: Error,
    readonly providerId: string,
    readonly modelId: string
  ) {
    super(cause.message, { cause })
    this.name = 'MissingFinishReasonError'
  }
}

export function isMissingFinishReason(error: unknown): error is InvalidResponseDataError {
  return InvalidResponseDataError.isInstance(error) && error.message === MISSING_FINISH_REASON_MESSAGE
}

export type RecoverableModelTransportFailure = 'network-unavailable' | 'interrupted'

export function recoverableModelTransportFailure(error: unknown): RecoverableModelTransportFailure | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 12; depth++) {
    if (APICallError.isInstance(current) && current.statusCode !== undefined && current.statusCode >= 400)
      return undefined
    if (isCancellation(current)) return undefined
    if (current instanceof MissingFinishReasonError || isMissingFinishReason(current)) return 'interrupted'
    const code = 'code' in current && typeof current.code === 'string' ? current.code : undefined
    const chromiumCode = /^net::(ERR_[A-Z_]+)$/.exec(current.message)?.[1]
    switch (code ?? chromiumCode) {
      case 'ERR_INTERNET_DISCONNECTED':
      case 'ERR_NETWORK_IO_SUSPENDED':
      case 'ENETDOWN':
        return 'network-unavailable'
      case 'ERR_NETWORK_CHANGED':
      case 'ERR_CONNECTION_RESET':
      case 'ERR_CONNECTION_CLOSED':
      case 'ERR_CONNECTION_ABORTED':
      case 'ECONNRESET':
      case 'ECONNABORTED':
      case 'UND_ERR_SOCKET':
        return 'interrupted'
    }
    current = RetryError.isInstance(current) ? current.lastError : current.cause
  }
  return undefined
}

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
  if (error instanceof ProviderContextOverflowError) {
    return { ...facts, source: 'provider', kind: 'expected', reason: error.providerErrorCategory }
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
