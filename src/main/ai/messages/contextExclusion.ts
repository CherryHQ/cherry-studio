/**
 * Per-message context exclusion (selective context, GOREVLER-2 Q2).
 *
 * A user can tick individual old messages out of the history a turn sends to
 * the model, without deleting them or cutting a clear-context boundary. The
 * exclusion set lives in a Preference (keyed by message id), never on the
 * persisted message itself, and is applied here as a plain row filter — the
 * message stays in the tree and stays visible in the UI, it just never
 * reaches `toModelMessages`. Dropping an arbitrary row (not just a prefix) is
 * safe: v2 keeps tool calls and their results inside one message's parts, so
 * removing a row cannot orphan a tool result, and `coalesceConsecutiveSameRole`
 * already merges whatever adjacency this leaves behind.
 */
export function applyContextExclusions<T extends { id: string }>(messages: T[], excludedIds: ReadonlySet<string>): T[] {
  if (excludedIds.size === 0) return messages
  return messages.filter((message) => !excludedIds.has(message.id))
}
