/**
 * "Last N messages" context window (v1 contextCount successor).
 *
 * Pure slice over an already-served message list: keeps the last `maxMessages`
 * rows, then extends BACKWARD until the window opens on a `user` row — a reply
 * must never appear without its prompt, and the continue-dispatch path (tool
 * approval resume) legitimately ends the history on an assistant row, so
 * trimming forward could empty the window mid-turn. Extension is bounded by
 * the current turn's size; the result is never empty for a non-empty input.
 *
 * Role-based only: v2 chat keeps tool invocations inside assistant message
 * parts, so row-level slicing cannot orphan a tool result.
 *
 * The early return is deliberately NOT a normalization pass: a history shorter
 * than the window is served unchanged, so this never converts an
 * already-assistant-leading history into a user-leading one. Guaranteeing that
 * belongs to `toModelMessages`; doing it here would truncate large-N windows
 * for no benefit.
 */

/**
 * Coerce a stored `maxMessages` into a usable window size.
 *
 * PreferenceService and the assistant settings JSON both hand back whatever the
 * database holds, with no schema enforcement at the boundary — so `0`, a
 * negative, a fraction, `NaN` or a non-number all reach here. `0`/negatives are
 * the dangerous ones: they made `start` land at or past `messages.length`, and
 * the loop then read `.role` off `undefined` and threw, which fails the whole
 * request in both the persistent and temporary chat paths.
 *
 * Anything unusable resolves to `null` (no limit) rather than to a guessed
 * number: serving the full history is the pre-existing behavior and is never
 * surprising, whereas inventing a window would silently drop context.
 * Fractions floor, since "keep 2.7 messages" can only mean 2.
 */
export function normalizeMaxMessages(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const floored = Math.floor(value)
  return floored >= 1 ? floored : null
}

export function applyMaxMessagesWindow<T extends { role: string }>(messages: T[], maxMessages: number | null): T[] {
  const limit = normalizeMaxMessages(maxMessages)
  if (limit === null || messages.length <= limit) return messages
  let start = messages.length - limit
  while (start > 0 && messages[start].role !== 'user') start--
  return messages.slice(start)
}
