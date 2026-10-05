/**
 * Terminal-error sentinels for assistant turns.
 *
 * Every path that flips a persisted turn to `error` must leave behind an
 * error part with a non-empty message. Three otherwise-diagnosable-less paths
 * (persist-failure recovery, boot reconciliation of crash-orphaned rows, and
 * turns that burned tokens without producing content) previously wrote
 * `status='error'` with zero parts, so history showed a bubble with nothing in
 * it. These sentinels give those paths a truthful, classified error.
 *
 * Cross-process: `main` writes them, the renderer's `ErrorBlock` renders them.
 */

import type { SerializedError } from '../types/error'

/** Renderer key prefix — `ErrorBlock` resolves `error.${i18nKey}`. See the SerializedError doc comment. */
export const TERMINAL_I18N_PREFIX = 'error'

/**
 * Error categories that own a turn's terminal state. Each maps to an `error.*`
 * i18n key rendered by `ErrorBlock`, so the user sees a resolved sentence
 * rather than a raw string.
 */
export type TerminalSentinelKey =
  | 'turn.persist_failed'
  | 'turn.orphaned_by_restart'
  | 'turn.interrupted'
  | 'turn.no_content'

interface SentinelSpec {
  /** i18n key suffix; rendered as `error.${key}` — must exist in `en-us.json`. */
  readonly i18nKey: TerminalSentinelKey
  /** Fallback when the i18n key is missing or the locale has no entry. */
  readonly message: string
  /** Serialized `name` field — shown in error details, never the user-facing sentence. */
  readonly name: string
}

const SENTINELS: Record<TerminalSentinelKey, SentinelSpec> = {
  'turn.persist_failed': {
    i18nKey: 'turn.persist_failed',
    name: 'TerminalPersistenceError',
    message: 'The reply was produced but could not be saved.'
  },
  'turn.orphaned_by_restart': {
    i18nKey: 'turn.orphaned_by_restart',
    name: 'InterruptedTurnError',
    message: 'This reply was interrupted and its unsent text was lost. Resend your message to try again.'
  },
  'turn.interrupted': {
    i18nKey: 'turn.interrupted',
    name: 'InterruptedTurnError',
    message: 'The reply was interrupted before it finished.'
  },
  'turn.no_content': {
    i18nKey: 'turn.no_content',
    name: 'EmptyTurnError',
    message: 'The model finished the request without producing a reply.'
  }
}

export interface TerminalSentinelOptions {
  /**
   * Replaces the sentinel's default English `message`. Callers pass it only when
   * they have a more specific truth (e.g. the OS signal that killed the run);
   * the value must already be user-presentable, not a raw stack.
   */
  readonly detail?: string
}

/**
 * Build a {@link SerializedError} that always carries a displayable message.
 *
 * `i18nKey` is authoritative when the renderer has the key; `message` is the
 * English fallback and the value every non-renderer consumer reads. Neither is
 * ever blank — an `error` terminal with no error text is exactly the defect
 * this module exists to prevent.
 */
export function terminalSentinel(key: TerminalSentinelKey, options?: TerminalSentinelOptions): SerializedError {
  const spec = SENTINELS[key]
  return {
    name: spec.name,
    message: options?.detail?.trim() || spec.message,
    stack: null,
    i18nKey: spec.i18nKey
  }
}

/** The i18n suffix for a sentinel — for tests and the i18n key-existence check. */
export function terminalSentinelI18nKey(key: TerminalSentinelKey): string {
  return SENTINELS[key].i18nKey
}

/**
 * Attach a terminal sentinel error part to a persisted message's `parts`.
 *
 * Every path that writes `status='error'` must go through this (or fold an error
 * part another way) so no error row reaches storage with no error text — a row
 * marked failed with nothing explaining it is undiagnosable in the UI and in
 * support logs. Existing parts are preserved; the sentinel is appended unless an
 * error part is already present.
 */
export function withTerminalErrorPart(
  data: { parts?: unknown } | null | undefined,
  key: TerminalSentinelKey,
  options?: TerminalSentinelOptions
): { parts: unknown[] } {
  const existing = Array.isArray(data?.parts) ? (data?.parts as unknown[]) : []
  const hasError = existing.some(
    (part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'data-error'
  )
  if (hasError) return { parts: existing }

  const error = terminalSentinel(key, options)
  return { parts: [...existing, { type: 'data-error', data: error }] }
}
