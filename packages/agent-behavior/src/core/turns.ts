import type { HistoryEntry } from './facts'

/** An input that starts a run: a person's message, a goal round, or a notification that wakes the agent. */
export const startsTurn = (entry: HistoryEntry): boolean =>
  entry.kind === 'user' ||
  (entry.kind === 'marker' &&
    (entry.marker.type === 'goal-round' || (entry.marker.type === 'subagent-notification' && !entry.marker.quiet)))
