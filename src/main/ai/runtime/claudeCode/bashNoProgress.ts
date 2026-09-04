/**
 * Stuck-loop detection for repeated Bash calls that never produce new output.
 *
 * The recorder (a PostToolUse/PostToolUseFailure hook) appends one entry per Bash execution, plus a
 * break-marker when a mutating tool completes; the `bash-repeat-no-progress` guard rule denies the
 * next identical call once the trailing run of the same normalized command reaches the threshold
 * with a single unchanged fingerprint. Output that changes at all — new bytes, different error
 * text — counts as progress and resets the signal, as does any completed workspace mutation or a
 * user interrupt (Esc).
 */

import { createHash } from 'node:crypto'

/** Consecutive identical-output runs of one command that must be recorded before the next is denied. */
export const BASH_NO_PROGRESS_THRESHOLD = 3
/** Per-session ring size; only the tail matters, so old entries are dropped. */
export const BASH_HISTORY_LIMIT = 16

/**
 * Sentinel command for break-marker entries: a mutating tool changed the workspace, so any run in
 * progress ends here. The NUL prefix can never equal a normalized real command.
 */
export const BASH_RUN_BREAK_MARKER = '\0tool-mutation'

/** Claude Code tools whose successful completion mutates the workspace and therefore breaks a run. */
export const BASH_RUN_BREAK_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export interface BashOutcome {
  readonly command: string
  readonly fingerprint: string
}

/**
 * Collapses all whitespace — including inside shell syntax and quoted arguments — so formatting
 * variants count as the same command. Two genuinely distinct commands can therefore alias onto one
 * run; that is acceptable because the guard only fires when the OUTPUT is also byte-identical,
 * in which case the retry carries no new information either way.
 */
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
    // An older differing fingerprint ends the trailing run; it does not abort the scan.
    if (entry.fingerprint !== fingerprint) break
    run++
  }
  return run >= BASH_NO_PROGRESS_THRESHOLD ? run : undefined
}
