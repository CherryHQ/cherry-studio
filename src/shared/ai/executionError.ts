import type { SerializedError } from '../types/error'
import { classifyErrorCategory, type ErrorCategory, isErrorCategory } from '../utils/errorCategory'
import { getSafeProviderErrorMessage } from './providerError'

export interface ClassifiedExecutionError extends SerializedError {
  executionErrorCategory: ErrorCategory
}

export function isClassifiedExecutionError(error: SerializedError): error is ClassifiedExecutionError {
  return isErrorCategory(error.executionErrorCategory)
}

function isRetryError(error: SerializedError): boolean {
  return 'cause' in error && 'reason' in error && 'lastError' in error && 'errors' in error
}

/**
 * Serialized wrappers may contain partial error records.
 */
export function unwrapNestedExecutionErrors(error: SerializedError): SerializedError[] {
  const nested = isRetryError(error)
    ? [error.lastError, ...(Array.isArray(error.errors) ? error.errors : [])]
    : 'cause' in error && 'originalError' in error
      ? [error.originalError]
      : []

  return nested.filter(
    (candidate): candidate is SerializedError =>
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
  )
}

/** `statusCode` or `status`, numeric or a numeric string. Unparseable values count as absent. */
export function readStructuredHttpStatus(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = record.statusCode ?? record.status
  const parsed = typeof status === 'string' && /^\d{3}$/.test(status.trim()) ? Number(status) : status
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : undefined
}

/**
 * The model / provider ids from a locally raised resolution failure ("Cannot resolve modelId…").
 * Main rejects those before any provider call, so the ids are the only layer detail the user can
 * act on — a provider 404 body already names the model in its own text. Null for anything else.
 */
export function getLocalModelResolutionFailure(
  error?: SerializedError
): { providerId?: string; modelId?: string } | null {
  const message = typeof error?.message === 'string' ? error.message : ''

  // AiService cannot supply an identifier when neither the request nor assistant has a model.
  // Keep the local failure recognizable without treating the word "not" as a model ID.
  if (/^Cannot resolve (?:providerId|modelId): not in request and assistant has no model$/.test(message)) {
    return {}
  }

  // Format 1: "Cannot resolve modelId: <id>" or "Cannot resolve providerId: <id>"
  if (/^Cannot resolve (?:providerId|modelId)/.test(message)) {
    const prefixMatch = /^Cannot resolve (?:providerId|modelId):\s*([^,\s]+)/.exec(message)
    if (prefixMatch) {
      return { modelId: prefixMatch[1] }
    }

    // Format 2: "Cannot resolve modelId="..."" or "Cannot resolve providerId="..."" (quoted)
    const providerId = /providerId="([^"]+)"/.exec(message)?.[1]
    const modelId = /modelId="([^"]+)"/.exec(message)?.[1]
    if (modelId) return { providerId, modelId }

    // Format 3: "[model1,model2,model3]" list format
    const list = /\[([^\]]*)\]/.exec(message)
    if (list) {
      const m = list[1]
        .split(',')
        .map((id) => id.trim())
        .find(Boolean)
      return m ? { modelId: m } : null
    }

    return null
  }

  const providerIdMatch = /^Provider with id '(.+)' not found$/s.exec(message)
  if (providerIdMatch) return { providerId: providerIdMatch[1] }

  // Format 4: "Model with id 'provider/model' not found" (DataApiErrorFactory.notFound)
  const modelIdMatch = /^Model with id '([^']+)' not found$/.exec(message)
  if (modelIdMatch) {
    return { modelId: modelIdMatch[1] }
  }

  return null
}

/**
 * A status-less RetryError copies the terminal phrase. Return that attempt's HTTP 5xx;
 * earlier attempts do not supply a status.
 */
export function getErrorHttpStatus(error: SerializedError): number | undefined {
  const outer = readStructuredHttpStatus(error)
  if (outer !== undefined) return outer
  if (!isRetryError(error)) return undefined
  const terminalStatus = readStructuredHttpStatus(error.lastError)
  return terminalStatus !== undefined && terminalStatus >= 500 && terminalStatus < 600 ? terminalStatus : undefined
}

export function isCodexUnsupportedModelError(error: SerializedError): boolean {
  return /model is not supported when using Codex with a ChatGPT account/i.test(
    [error.message, getSafeProviderErrorMessage(error)].join('\n')
  )
}

export function classifyExecutionError(error: SerializedError): ErrorCategory {
  if (isClassifiedExecutionError(error)) return error.executionErrorCategory
  if (error.errorSource === 'local') return 'unknown'
  if (error.i18nKey === 'chat.provider_sign_in_required' && typeof error.providerId === 'string') return 'auth'
  if (isCodexUnsupportedModelError(error)) return 'model'
  if (isErrorCategory(error.claudeCodeExitCategory)) return error.claudeCodeExitCategory
  if (isErrorCategory(error.providerErrorCategory) && error.providerErrorCategory !== 'unknown') {
    return error.providerErrorCategory
  }
  if (getLocalModelResolutionFailure(error)) return 'model'

  const numStatus = getErrorHttpStatus(error)

  const responseBodyText = typeof error.responseBody === 'string' ? error.responseBody : ''
  let dataText = ''
  if (error.data != null) {
    try {
      dataText = typeof error.data === 'string' ? error.data : JSON.stringify(error.data)
    } catch {
      // An unserializable provider field cannot supply diagnosis text.
    }
  }

  const category = classifyErrorCategory({
    text: [error.message ?? '', responseBodyText, dataText].filter(Boolean).join('\n'),
    status: numStatus,
    finishReason: String(error.finishReason ?? '')
  })
  if (
    isRetryError(error) &&
    readStructuredHttpStatus(error) === undefined &&
    classifyErrorCategory({ finishReason: String(error.finishReason ?? '') }) === 'unknown'
  ) {
    const terminal = error.lastError
    const terminalCategory =
      terminal && typeof terminal === 'object' && !Array.isArray(terminal) && 'providerErrorCategory' in terminal
        ? terminal.providerErrorCategory
        : undefined
    // A retry wrapper's copied prose cannot override its terminal attempt's normalized identity.
    if (isErrorCategory(terminalCategory) && terminalCategory !== 'unknown') return terminalCategory
  }
  if (category !== 'unknown' && category !== 'bad_request') return category

  let fallback = category
  for (const nested of unwrapNestedExecutionErrors(error)) {
    const nestedCategory = classifyExecutionError(nested)
    if (nestedCategory !== 'unknown' && nestedCategory !== 'bad_request') return nestedCategory
    if (nestedCategory === 'bad_request') fallback = nestedCategory
  }
  return fallback
}
