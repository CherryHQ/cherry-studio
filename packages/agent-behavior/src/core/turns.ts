import type { ItemId } from '@cherrystudio/agent-runtime'

import type { HistoryEntry, LiveFacts } from './facts'

/** A run is going: inputs a failed run left keep a conversation from idling, but they are no run. */
export const runActive = (live: LiveFacts): boolean => !live.idle && live.leftoverInputs === 0

/** An input that starts a run: a person's message, a goal round, or a notification that wakes the agent. */
export const startsTurn = (entry: HistoryEntry): boolean =>
  entry.kind === 'user' ||
  (entry.kind === 'marker' &&
    (entry.marker.type === 'goal-round' || (entry.marker.type === 'subagent-notification' && !entry.marker.quiet)))

/**
 * The turn a stop recorded under `key` names (H2): the last one begun before that record, or before now while it is not
 * written yet; `undefined` when no turn had begun.
 */
export function stoppedTurn(history: readonly HistoryEntry[], key: string): ItemId | undefined {
  let turn: ItemId | undefined
  for (const entry of history) {
    if (entry.kind === 'record' && entry.key === key) break
    if (startsTurn(entry)) turn = entry.id
  }
  return turn
}

/** A stop is recorded for the turn begun last; every stop writes its record in its deciding commit (R5). */
export function turnStopping(history: readonly HistoryEntry[]): boolean {
  let stopped: boolean | undefined
  for (const entry of history) {
    if (startsTurn(entry)) stopped = false
    else if (stopped === false && entry.kind === 'record' && entry.record.type === 'turn-stop') stopped = true
  }
  return stopped === true
}

export type Turn = 'human' | 'round' | 'notification'
/** Which turn `entry` starts, by `startsTurn`; `undefined` for an entry that starts none (a quiet marker included). */
export function turnKind(entry: HistoryEntry): Turn | undefined {
  if (!startsTurn(entry)) return undefined
  if (entry.kind === 'user') return 'human'
  return entry.kind === 'marker' && entry.marker.type === 'goal-round' ? 'round' : 'notification'
}
