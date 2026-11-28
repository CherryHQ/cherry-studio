import {
  type ClassifiedExecutionError,
  classifyExecutionError,
  getErrorHttpStatus,
  isClassifiedExecutionError,
  readStructuredHttpStatus
} from '@shared/ai/executionError'
import { getSafeProviderErrorMessage } from '@shared/ai/providerError'
import type { SerializedError } from '@shared/types/error'

const REQUEST_400_PREFIX =
  /^\s*(?:400:|HTTP(?:\/\d+(?:\.\d+)?)?\s+400\b|API Error:\s*400\b|(?:Request rejected|API error) \(400\))/i

export function normalizeExecutionError(error: SerializedError, originalError?: unknown): ClassifiedExecutionError {
  if (isClassifiedExecutionError(error)) return error
  if (error.errorSource === 'local') return { ...error, executionErrorCategory: 'unknown' }

  const text =
    typeof originalError === 'string'
      ? originalError
      : originalError instanceof Error
        ? originalError.message
        : (error.message ?? '')
  const explicitStatus = readStructuredHttpStatus(originalError) ?? readStructuredHttpStatus(error)
  const wrappedStatus = explicitStatus === undefined ? getErrorHttpStatus(error) : undefined
  const recovered = explicitStatus === undefined && wrappedStatus === undefined && REQUEST_400_PREFIX.test(text)
  const normalized = {
    ...error,
    ...(explicitStatus !== undefined && { statusCode: explicitStatus }),
    ...(recovered && { statusCode: 400, message: getSafeProviderErrorMessage({ message: text }), stack: null })
  }
  return {
    ...normalized,
    ...(wrappedStatus !== undefined && { statusCode: wrappedStatus }),
    executionErrorCategory: classifyExecutionError(normalized)
  }
}
