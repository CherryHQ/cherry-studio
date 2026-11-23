import type { Serializable } from '@shared/types/serializable'
import { REDACTED, redactSecretText } from '@shared/utils/redaction'

// Mirrors the shared-ai safe message length without importing AI logic:
// The file envelope concatenates fileMessage and entry.message, so this counts twice.
const MAX_ERROR_MESSAGE_CHARS = 500
const MAX_ERROR_STACK_CHARS = 4000
const MAX_SAFE_ERROR_TAG_CHARS = 100
const MAX_NESTED_SANITIZE_DEPTH = 5

type SafeLogError = Pick<Error, 'name' | 'message' | 'stack'> & {
  reportingHandled?: true
  code?: string
  statusCode?: number | null
  status?: number | null
  reason?: string
  isRetryable?: boolean
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error instances can carry overwritten message values; coerce and redact only within toSafeError's guarded serialization.
function safeErrorText(value: unknown): string {
  const redacted = redactSecretText(String(value ?? ''))

  return redacted.length > MAX_ERROR_MESSAGE_CHARS ? `${redacted.slice(0, MAX_ERROR_MESSAGE_CHARS)}…` : redacted
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Revoked proxies can throw during instanceof; a failed probe must not suppress the log or its observer.
export function getLogError(value: unknown): Error | undefined {
  try {
    return value instanceof Error ? value : undefined
  } catch {
    return undefined
  }
}

export function toSafeError(error: Error): SafeLogError {
  try {
    const safe: SafeLogError = {
      name: redactSecretText(String(error.name ?? 'Error')).slice(0, MAX_SAFE_ERROR_TAG_CHARS),
      message: safeErrorText(error.message)
    }

    const stack = error.stack
    const reportingHandled = 'reportingHandled' in error ? error.reportingHandled : undefined
    const code = 'code' in error ? error.code : undefined
    const statusCode = 'statusCode' in error ? error.statusCode : undefined
    const status = 'status' in error ? error.status : undefined
    const reason = 'reason' in error ? error.reason : undefined
    const isRetryable = 'isRetryable' in error ? error.isRetryable : undefined

    if (typeof stack === 'string') safe.stack = redactSecretText(stack).slice(0, MAX_ERROR_STACK_CHARS)

    if (reportingHandled === true) safe.reportingHandled = true

    if (typeof code === 'string' && code.length <= MAX_SAFE_ERROR_TAG_CHARS) safe.code = redactSecretText(code)

    if (typeof statusCode === 'number') safe.statusCode = Number.isFinite(statusCode) ? statusCode : null

    if (typeof status === 'number') safe.status = Number.isFinite(status) ? status : null

    if (typeof reason === 'string' && reason.length <= MAX_SAFE_ERROR_TAG_CHARS) safe.reason = redactSecretText(reason)

    if (typeof isRetryable === 'boolean') safe.isRetryable = isRetryable

    return safe
  } catch {
    return { name: 'Error', message: REDACTED }
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Main callers and renderer logs supply arbitrary metadata; bound recursive traversal and redact unsupported or unreadable values before file output.
export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): Serializable {
  try {
    if (value == null) return null

    if (typeof value === 'string' || typeof value === 'boolean') return value

    if (typeof value === 'number') return Number.isFinite(value) ? value : null

    if (typeof value !== 'object') return REDACTED

    if (seen.has(value)) return '[Circular]'

    if (depth >= MAX_NESTED_SANITIZE_DEPTH) return '[Truncated]'

    if (value instanceof Error) return toSafeError(value)
    seen.add(value)

    if (Array.isArray(value)) {
      const length = value.length

      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 0xffffffff) return REDACTED

      const output = new Array<Serializable>(length)

      for (let index = 0; index < length; index++) {
        if (index in value) output[index] = sanitizeLogValue(value[index], depth + 1, seen)
      }

      return output
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitizeLogValue(nested, depth + 1, seen)] as const)
    )
  } catch {
    return REDACTED
  }
}
