import type { ContextMessage } from './types'

const PLACEHOLDER_TOOL_RESULT = '[No tool result available]'
const PLACEHOLDER_ORPHAN_REMOVED = '[Conversation continues]'

/**
 * Sanitizes a message history to satisfy LLM API invariants.
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author).
 *
 * Fixes three classes of problems:
 *
 * 1. **Orphan tool results** — a `role: 'tool'` message whose `tool_call_id`
 *    has no matching `tool_calls` entry in a preceding assistant message.
 *    These are removed (or replaced with a placeholder if removal would
 *    leave the history empty).
 *
 * 2. **Missing tool results** — an assistant message has `tool_calls` but
 *    no subsequent `role: 'tool'` message with a matching `tool_call_id`.
 *    A synthetic tool result with `content: '[No tool result available]'`
 *    is injected, carrying the originating tool name on the IR `name` field
 *    so output adapters can emit a meaningful `toolName`.
 *
 * 3. **First message must be user** — if the first non-system message is
 *    not `role: 'user'`, a synthetic user placeholder is prepended.
 *
 * This function does NOT modify the input array. It returns a new array.
 *
 * Sanitization is intentionally silent — to observe what was changed, call
 * this function explicitly and compare the input and output.
 */
export function ensureValidHistory(history: ContextMessage[]): ContextMessage[] {
  if (history.length === 0) return []

  let result = [...history]

  // ── Step 1: Fix orphan tool results ──
  result = fixOrphanToolResults(result)

  // ── Step 2: Fix missing tool results ──
  result = fixMissingToolResults(result)

  // ── Step 3: Ensure first non-system message is user ──
  result = ensureFirstMessageIsUser(result)

  return result
}

/**
 * Remove tool messages whose tool_call_id has no matching assistant tool_calls.
 */
function fixOrphanToolResults(messages: ContextMessage[]): ContextMessage[] {
  const result: ContextMessage[] = []
  const knownToolCallIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    // Track tool_call ids as we encounter assistant messages
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        knownToolCallIds.add(tc.id)
      }
    }

    if (msg.role === 'tool' && msg.tool_call_id) {
      if (!knownToolCallIds.has(msg.tool_call_id)) {
        // Orphan — skip it
        continue
      }
    }

    result.push(msg)
  }

  // If we removed everything, keep a placeholder
  if (result.length === 0 && messages.length > 0) {
    return [{ role: 'user', content: PLACEHOLDER_ORPHAN_REMOVED }]
  }

  return result
}

/**
 * For each assistant with tool_calls, ensure every tool_call_id has a matching
 * tool result in the subsequent messages (before the next assistant or user message).
 *
 * Injected placeholders carry the original tool name (from the assistant's
 * `tool_calls[].function.name`) on the IR `name` field so downstream output
 * adapters can emit a meaningful `toolName` instead of falling back to a
 * literal `'unknown'`. Providers that validate `toolName` against the
 * assistant's tool calls (Gemini, strict middleware paths) would otherwise
 * reject the synthesized result.
 */
function fixMissingToolResults(messages: ContextMessage[]): ContextMessage[] {
  const result: ContextMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    result.push(msg)

    if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length === 0) {
      continue
    }

    // Collect expected tool_call_ids and their tool names
    const expectedIds = new Set(msg.tool_calls.map((tc) => tc.id))
    const idToName = new Map(msg.tool_calls.map((tc) => [tc.id, tc.function.name]))

    // Scan forward for matching tool results
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]
      if (next.role === 'tool' && next.tool_call_id) {
        expectedIds.delete(next.tool_call_id)
      }
      // Stop scanning at the next assistant or user message
      if (next.role === 'assistant' || next.role === 'user') {
        break
      }
    }

    // Inject synthetic tool results for any missing ids
    for (const missingId of expectedIds) {
      const name = idToName.get(missingId)
      result.push({
        role: 'tool',
        tool_call_id: missingId,
        content: PLACEHOLDER_TOOL_RESULT,
        ...(name ? { name } : {})
      })
    }
  }

  return result
}

/**
 * Ensure the first non-system message is role: 'user'.
 */
function ensureFirstMessageIsUser(messages: ContextMessage[]): ContextMessage[] {
  const firstNonSystemIdx = messages.findIndex((m) => m.role !== 'system')

  if (firstNonSystemIdx === -1) {
    // All system messages — nothing to fix
    return messages
  }

  if (messages[firstNonSystemIdx].role === 'user') {
    return messages
  }

  // Insert a synthetic user message before the first non-system message
  const result = [...messages]
  result.splice(firstNonSystemIdx, 0, {
    role: 'user',
    content: PLACEHOLDER_ORPHAN_REMOVED
  })
  return result
}
