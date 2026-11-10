import type { ErrorCategory } from '@shared/utils/errorCategory'

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

/**
 * Structured mid-turn observation failure for the Pi runtimes.
 *
 * Replaces the generic `Pi observation interrupted/ended` Errors that surfaced
 * as a bare closed-transport message (the Pi successor of DSH's
 * `dsh bridge disconnected` / `JSON-RPC input closed`). The message names the
 * runtime component and the reason, marks the turn retryable, and carries the
 * session/backend/thread identity needed for main-process diagnostics.
 *
 * `providerErrorCategory: 'stream'` routes the serialized error to the stream
 * diagnosis (retry guidance) instead of the generic unknown-error wrapper.
 * `isRetryable` survives `serializeError` for IPC.
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
  readonly isRetryable = true
  readonly providerErrorCategory: ErrorCategory = 'stream'

  constructor(details: PiObservationErrorDetails) {
    super(describePiObservationFailure(details))
    this.runtime = details.runtime
    this.kind = details.kind
    this.reason = details.reason
    this.sessionId = details.sessionId
    this.backendId = details.backendId
    this.nativeThreadId = details.nativeThreadId
    this.causeMessage = details.causeMessage
    if (details.causeMessage) this.cause = details.causeMessage
  }

  toLogContext(): Record<string, unknown> {
    return {
      runtime: this.runtime,
      kind: this.kind,
      reason: this.reason,
      sessionId: this.sessionId,
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
