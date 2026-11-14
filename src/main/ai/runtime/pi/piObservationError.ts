import { classifyErrorCategory, extractHttpStatus, type ErrorCategory } from '@shared/utils/errorCategory'

export type PiObservationFailureKind = 'gap' | 'closed' | 'diagnostic' | 'outcome'
export type PiObservationRuntime = 'pi' | 'pi-durable'

export interface PiObservationErrorDetails {
  runtime: PiObservationRuntime
  kind: PiObservationFailureKind
  reason: string
  sessionId: string
  backendId?: string
  nativeThreadId?: string
  /** Original native diagnostic/outcome text, when one was reported. */
  causeMessage?: string
}

/** Categories where an automatic retry on the next turn is safe. */
const RETRYABLE_OBSERVATION_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  'stream',
  'network',
  'server',
  'rate_limit'
])

function isObservationLoss(kind: PiObservationFailureKind): boolean {
  return kind === 'gap' || kind === 'closed'
}

/**
 * Structured mid-turn observation failure for the Pi runtimes.
 *
 * Gap/closed events are transport observation loss: they name the runtime
 * component, stay retryable with the stream diagnosis, and carry localized
 * recovery copy plus the session/backend/thread identity for diagnostics.
 *
 * Diagnostic/outcome events carry the provider's own failure text. They keep
 * the structured runtime identity for logging/rebuild but preserve the
 * provider classification (e.g. auth stays auth with provider-settings
 * navigation, not stream) and its retry policy instead of forcing the stream
 * diagnosis.
 */
export class PiObservationError extends Error {
  override name = 'PiObservationError'
  readonly runtime: PiObservationRuntime
  readonly kind: PiObservationFailureKind
  readonly reason: string
  readonly sessionId: string
  readonly backendId?: string
  readonly nativeThreadId?: string
  readonly causeMessage?: string
  readonly isRetryable: boolean
  readonly providerErrorCategory?: ErrorCategory
  readonly statusCode?: number
  readonly i18nKey?: string
  readonly detailI18nKey?: string
  readonly detailI18nValues?: Record<string, string>

  constructor(details: PiObservationErrorDetails) {
    super(
      isObservationLoss(details.kind) ? describePiObservationFailure(details) : (details.causeMessage ?? details.reason)
    )
    this.runtime = details.runtime
    this.kind = details.kind
    this.reason = details.reason
    this.sessionId = details.sessionId
    this.backendId = details.backendId
    this.nativeThreadId = details.nativeThreadId
    this.causeMessage = details.causeMessage
    if (details.causeMessage) this.cause = details.causeMessage
    if (isObservationLoss(details.kind)) {
      this.providerErrorCategory = 'stream'
      this.isRetryable = true
      this.i18nKey =
        details.runtime === 'pi-durable' ? 'pi_durable_observation_interrupted' : 'pi_observation_interrupted'
      this.detailI18nKey = 'pi_observation_interrupted_detail'
      this.detailI18nValues = { reason: details.reason }
    } else {
      const combinedText = [details.causeMessage, details.reason].filter(Boolean).join('\n')
      const status = extractHttpStatus(combinedText)
      if (status !== undefined) this.statusCode = status
      const category = classifyErrorCategory({ text: combinedText, status })
      // Leave `unknown` unset so downstream (`toExecutionFailure`, renderer
      // `classifyError`) can still recover via its own status/text fallback
      // instead of being suppressed by an explicit `unknown`.
      if (category !== 'unknown') this.providerErrorCategory = category
      this.isRetryable = RETRYABLE_OBSERVATION_CATEGORIES.has(category)
    }
  }

  toLogContext(): Record<string, unknown> {
    return {
      runtime: this.runtime,
      kind: this.kind,
      reason: this.reason,
      sessionId: this.sessionId,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
      ...(this.providerErrorCategory ? { providerErrorCategory: this.providerErrorCategory } : {}),
      ...(this.backendId ? { backendId: this.backendId } : {}),
      ...(this.nativeThreadId ? { nativeThreadId: this.nativeThreadId } : {}),
      ...(this.causeMessage ? { causeMessage: this.causeMessage } : {})
    }
  }
}

export function isPiObservationError(error: unknown): error is PiObservationError {
  return error instanceof PiObservationError
}

function runtimeLabel(runtime: PiObservationRuntime): string {
  return runtime === 'pi-durable' ? 'Pi durable runtime' : 'Pi runtime'
}

export function describePiObservationFailure(details: PiObservationErrorDetails): string {
  const base =
    details.kind === 'gap'
      ? `${runtimeLabel(details.runtime)} observation interrupted (gap: ${details.reason})`
      : details.kind === 'closed'
        ? `${runtimeLabel(details.runtime)} observation ended (${details.reason})`
        : details.kind === 'outcome'
          ? `${runtimeLabel(details.runtime)} turn failed (${details.reason})`
          : `${runtimeLabel(details.runtime)} reported an error (${details.reason})`
  const recovery =
    'The turn was stopped before completion; send your message again — the session reconnects automatically.'
  const cause = details.causeMessage ? ` Detail: ${details.causeMessage}` : ''
  return `${base}. ${recovery}${cause}`
}
