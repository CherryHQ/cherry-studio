/**
 * Stuck-loop detection for repeated Bash calls that never produce new output.
 *
 * The recorder (a PostToolUse/PostToolUseFailure hook) appends one entry per Bash execution; the
 * `bash-repeat-no-progress` guard rule denies the next identical call once the trailing run of the
 * same normalized command reaches the threshold with a single unchanged fingerprint. Output that
 * changes at all — new bytes, different error text — counts as progress and resets the signal.
 */

import { createHash } from 'node:crypto'

/** Consecutive identical-output runs of one command that must be recorded before the next is denied. */
export const BASH_NO_PROGRESS_THRESHOLD = 3
/** Per-session ring size; only the tail matters, so old entries are dropped. */
export const BASH_HISTORY_LIMIT = 16

export interface BashOutcome {
  readonly command: string
  readonly fingerprint: string
}

export function normalizeBashCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/** Success and failure fingerprints never collide, so a flaky-then-fixed run reads as progress. */
export function fingerprintBashOutput(output: unknown, failed: boolean): string {
  const text = typeof output === 'string' ? output : (JSON.stringify(output) ?? '')
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)
  return `${failed ? 'err' : 'ok'}:${hash}`
}

/**
 * Returns the trailing run length when `command` already heads a run of at least
 * BASH_NO_PROGRESS_THRESHOLD identical-fingerprint outcomes, undefined otherwise.
 */
export function bashNoProgressRunLength(history: readonly BashOutcome[], command: string): number | undefined {
  const normalized = normalizeBashCommand(command)
  if (!normalized) return undefined

  let run = 0
  let fingerprint: string | undefined
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.command !== normalized) break
    fingerprint ??= entry.fingerprint
    if (entry.fingerprint !== fingerprint) return undefined
    run++
  }
  return run >= BASH_NO_PROGRESS_THRESHOLD ? run : undefined
}
