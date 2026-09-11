import { redactSecretText, redactToShape, redactUrlParams } from '@shared/utils/redaction'

const MAX_MESSAGE_CHARS = 500
const MAX_STACK_CHARS = 600
const MAX_RESPONSE_BODY_CHARS = 1000
/** RetryError → APICallError is the common chain; anything deeper is noise. */
const MAX_NESTED_DEPTH = 2

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text
}

function safeText(value: unknown, max: number): string {
  return truncate(redactSecretText(String(value)), max)
}

/**
 * Redacted, size-bounded view of a failed provider exchange for the error log —
 * the diagnostic bundle's only carrier of the request/response that failed
 * (the persisted message error drops both payloads before it reaches storage).
 *
 * The request body is reduced to its shape: keys, scalars and tool names stay,
 * conversation text does not.
 */
export function chatErrorContext(error: unknown, depth = 0): Record<string, unknown> {
  if (!(typeof error === 'object' && error !== null)) {
    return { errorMessage: safeText(error, MAX_MESSAGE_CHARS) }
  }

  const source = error as Record<string, unknown>
  const context: Record<string, unknown> = {}

  if (error instanceof Error) {
    context.errorName = error.name
    context.errorMessage = safeText(error.message, MAX_MESSAGE_CHARS)
    if (error.stack) context.stack = safeText(error.stack, MAX_STACK_CHARS)
  }
  if (typeof source.url === 'string') context.url = redactUrlParams(source.url)
  if (typeof source.statusCode === 'number') context.statusCode = source.statusCode
  // Node errno (`ECONNREFUSED`) and JSON-RPC codes — the most stable anchors the log scan has.
  if (typeof source.code === 'string' || typeof source.code === 'number') context.code = source.code
  if (typeof source.statusText === 'string') context.statusText = safeText(source.statusText, MAX_MESSAGE_CHARS)
  if (typeof source.isRetryable === 'boolean') context.isRetryable = source.isRetryable
  if (typeof source.reason === 'string') context.reason = safeText(source.reason, MAX_MESSAGE_CHARS)
  if (source.requestBodyValues != null) context.requestShape = redactToShape(source.requestBodyValues)
  if (source.responseBody != null) context.responseBody = safeText(source.responseBody, MAX_RESPONSE_BODY_CHARS)
  if (source.responseHeaders != null) context.responseHeaders = redactToShape(source.responseHeaders)
  if (source.data != null) context.data = redactToShape(source.data)
  if (typeof source.toolName === 'string') context.toolName = source.toolName
  // The "we parsed it wrong" side: JSONParseError.text, TypeValidationError.value,
  // and the zod issues its cause carries — all name the field that failed.
  if (typeof source.text === 'string') context.text = safeText(source.text, MAX_RESPONSE_BODY_CHARS)
  if (source.value !== undefined) context.value = redactToShape(source.value)
  if (Array.isArray(source.issues)) context.issues = redactToShape(source.issues)
  if (source.cause != null) {
    context.cause =
      source.cause instanceof Error && depth < MAX_NESTED_DEPTH
        ? chatErrorContext(source.cause, depth + 1)
        : safeText(source.cause, MAX_MESSAGE_CHARS)
  }
  if (source.lastError != null && depth < MAX_NESTED_DEPTH) {
    context.lastError = chatErrorContext(source.lastError, depth + 1)
  }

  return context
}
