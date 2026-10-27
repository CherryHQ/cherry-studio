import type { ErrorEvent } from '@sentry/electron/main'

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_EVENTS_PER_CLASS = 10
const EXPECTED_ERROR_TYPES = new Set(['AbortError', 'CanceledError', 'TimeoutError'])
const EXPECTED_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ERR_CANCELED',
  'ERR_ABORTED',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
  'ENETUNREACH',
  'ERR_NAME_NOT_RESOLVED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_CONNECTION_REFUSED',
  'ECONNREFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ECONNRESET',
  'ECONNABORTED',
  'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_UNSUPPORTED',
  'ERR_PROXY_AUTH_REQUESTED'
])
const EXPECTED_ERROR_MESSAGE = new RegExp(
  `^(?:net::|read |connect |Error: )?(?:${[...EXPECTED_ERROR_CODES].join('|')})\\b`
)

function normalizeMessage(message: string): string {
  return message
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, '<id>')
    .replace(/\b(?:0x[\da-f]+|\d{10,})\b/gi, '<id>')
}

function isExpectedFailure(event: ErrorEvent): boolean {
  const exception = event.exception?.values?.at(-1)
  if (exception?.type && EXPECTED_ERROR_TYPES.has(exception.type)) return true
  if (typeof event.tags?.code === 'string' && EXPECTED_ERROR_CODES.has(event.tags.code)) return true

  const message = exception?.value ?? event.message ?? ''
  if (
    /^(?:fetch failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/.test(message)
  ) {
    return true
  }
  return EXPECTED_ERROR_MESSAGE.test(message)
}

/** One policy instance belongs to one main SDK, covering all renderer windows. */
export class SentryEventFilter {
  private readonly recentEvents = new Map<string, number>()
  private windowExpiresAt = 0
  private criticalCount = 0
  private unexpectedCount = 0

  allow(event: ErrorEvent): boolean {
    const critical =
      event.level === 'fatal' || event.tags?.['failure.kind'] === 'startup' || event.tags?.['failure.kind'] === 'render'
    const unhandled = event.exception?.values?.some((exception) => exception.mechanism?.handled === false)
    const unexpected = unhandled || event.tags?.['failure.kind'] === 'unexpected'
    if (!critical && (!unexpected || isExpectedFailure(event))) return false

    const now = Date.now()
    for (const [key, expiresAt] of this.recentEvents) {
      if (expiresAt <= now) this.recentEvents.delete(key)
    }
    if (now >= this.windowExpiresAt) {
      this.windowExpiresAt = now + RATE_WINDOW_MS
      this.criticalCount = 0
      this.unexpectedCount = 0
    }

    const signature = JSON.stringify([
      event.release,
      critical,
      event.tags?.['failure.kind'],
      event.tags?.service,
      normalizeMessage(event.message ?? ''),
      event.exception?.values?.map((exception) => [
        exception.type,
        normalizeMessage(exception.value ?? ''),
        exception.stacktrace?.frames?.slice(-5).map(({ filename, function: name, lineno }) => [filename, name, lineno])
      ])
    ])
    if (this.recentEvents.has(signature)) return false
    if ((critical ? this.criticalCount : this.unexpectedCount) >= MAX_EVENTS_PER_CLASS) return false

    // Only admitted events consume state; the two hourly budgets bound this map.
    this.recentEvents.set(signature, now + DUPLICATE_WINDOW_MS)
    if (critical) this.criticalCount++
    else this.unexpectedCount++
    return true
  }
}
