import { getSafeAiSdkErrorDiscriminants, getSafeProviderErrorMessage } from '@shared/ai/providerError'
import { redactSecretText, redactUrlParams } from '@shared/utils/redaction'

import { redactToShape } from './redactToShape'

const MAX_MESSAGE_CHARS = 500
const MAX_STACK_CHARS = 4000
const MAX_RESPONSE_INPUT_CHARS = 16_384
/** RetryError → APICallError is the common chain; anything deeper is noise. */
const MAX_NESTED_DEPTH = 2

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text
}

function safeText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : String(value)
  return truncate(getSafeProviderErrorMessage({ message: text }) || `<string:${text.length}>`, max)
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '<invalid-url>'
    url.hash = ''
    return truncate(redactUrlParams(url.toString()), MAX_MESSAGE_CHARS)
  } catch {
    return '<invalid-url>'
  }
}

function responseShape(value: unknown): unknown {
  if (typeof value === 'string' && value.length <= MAX_RESPONSE_INPUT_CHARS) {
    try {
      return redactToShape(JSON.parse(value), 'response')
    } catch {
      return redactToShape(value)
    }
  }
  return redactToShape(value, 'response')
}

function containsPayload(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null) return false
  const source = error as Record<string, unknown>
  if (['requestBodyValues', 'responseBody', 'data', 'text', 'value', 'issues'].some((key) => source[key] != null))
    return true
  return (
    depth < MAX_NESTED_DEPTH &&
    (containsPayload(source.cause, depth + 1) || containsPayload(source.lastError, depth + 1))
  )
}

function collectErrorContext(error: unknown, depth: number, hideMessage: boolean): Record<string, unknown> {
  if (!(typeof error === 'object' && error !== null)) {
    return { errorMessage: hideMessage ? redactToShape(error) : safeText(error, MAX_MESSAGE_CHARS) }
  }

  const source = error as Record<string, unknown>
  const context: Record<string, unknown> = getSafeAiSdkErrorDiscriminants({
    statusCode: source.statusCode,
    statusText: source.statusText,
    isRetryable: source.isRetryable,
    reason: source.reason,
    toolName: source.toolName
  })

  if (typeof source.name === 'string') context.errorName = safeText(source.name, MAX_MESSAGE_CHARS)
  const message = typeof source.message === 'string' ? source.message : getSafeProviderErrorMessage({ data: source })
  if (typeof source.message === 'string' || message) {
    context.errorMessage = hideMessage ? redactToShape(message) : safeText(message, MAX_MESSAGE_CHARS)
  }
  if (!hideMessage && typeof source.stack === 'string') {
    context.stack = redactSecretText(source.stack).slice(0, MAX_STACK_CHARS)
  }
  if (typeof source.url === 'string') context.url = safeUrl(source.url)
  // Node errno (`ECONNREFUSED`) and JSON-RPC codes — the most stable anchors the log scan has.
  if (typeof source.code === 'number') context.code = source.code
  if (typeof source.code === 'string') context.code = safeText(source.code, MAX_MESSAGE_CHARS)
  if (source.requestBodyValues != null) context.requestShape = redactToShape(source.requestBodyValues, 'request')
  if (source.responseBody != null) context.responseBody = responseShape(source.responseBody)
  if (source.responseHeaders != null) context.responseHeaders = redactToShape(source.responseHeaders, 'headers')
  if (source.data != null) context.data = redactToShape(source.data, 'response')
  if (typeof source.text === 'string') context.text = responseShape(source.text)
  if (source.value !== undefined) context.value = redactToShape(source.value, 'response')
  if (Array.isArray(source.issues)) context.issues = redactToShape(source.issues)
  if (source.cause != null) {
    context.cause = depth < MAX_NESTED_DEPTH ? collectErrorContext(source.cause, depth + 1, hideMessage) : '<max-depth>'
  }
  if (source.lastError != null && depth < MAX_NESTED_DEPTH) {
    context.lastError = collectErrorContext(source.lastError, depth + 1, hideMessage)
  }

  return context
}

/** Diagnostic-only payload shapes augment the shared error normalization without entering persisted errors. */
export function chatErrorContext(error: unknown): Record<string, unknown> {
  // Retry wrappers and parser causes can echo payloads from another level of the error chain.
  return collectErrorContext(error, 0, containsPayload(error))
}
