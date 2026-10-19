import type { HistoryEntry } from './facts'

/** An input that starts a run: a person's message, a goal round, or a notification that wakes the agent. */
export const startsTurn = (entry: HistoryEntry): boolean =>
  entry.kind === 'user' ||
  (entry.kind === 'marker' &&
    (entry.marker.type === 'goal-round' || (entry.marker.type === 'subagent-notification' && !entry.marker.quiet)))

export type Turn = 'human' | 'round' | 'notification'
/** Which turn `entry` starts, by `startsTurn`; `undefined` for an entry that starts none (a quiet marker included). */
export function turnKind(entry: HistoryEntry): Turn | undefined {
  if (!startsTurn(entry)) return undefined
  if (entry.kind === 'user') return 'human'
  return entry.kind === 'marker' && entry.marker.type === 'goal-round' ? 'round' : 'notification'
}
