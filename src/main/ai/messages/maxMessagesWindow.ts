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
 */
export function applyMaxMessagesWindow<T extends { role: string }>(messages: T[], maxMessages: number | null): T[] {
  if (maxMessages === null || messages.length <= maxMessages) return messages
  let start = messages.length - maxMessages
  while (start > 0 && messages[start].role !== 'user') start--
  return messages.slice(start)
}
