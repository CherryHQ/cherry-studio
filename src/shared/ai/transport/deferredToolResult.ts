/**
 * Outbound transport policy for tool results.
 *
 * A tool result's size is unbounded (a big file read, a large MCP response), and shipping every
 * one of them to the renderer on session load is what makes a long agent session slow. So an
 * oversized result does not cross the boundary: it is replaced by a small reference the renderer
 * resolves on demand through `ai.get_tool_result`.
 *
 * The trigger is **size**, not the tool's identity or the topic's type — that is what keeps this
 * from growing a per-tool allowlist. Below the threshold a result travels inline exactly as
 * before, so the overwhelming majority of tool cards never take a round trip.
 *
 * Both processes import this module: main encodes, renderer decodes. One definition, no drift.
 */

/** Where a deferred tool result can be fetched from. */
export interface DeferredToolResultRef {
  topicId: string
  messageId: string
  toolCallId: string
}

/** Replaces a tool part's `output` when the real value was too large to send. */
export interface DeferredToolOutput {
  $deferredToolResult: DeferredToolResultRef
}

/**
 * Serialized UTF-8 size at or below which a result travels inline. Tuned so ordinary tool cards
 * (web search, knowledge search, a small file read) are unaffected and only genuinely heavy
 * payloads defer.
 */
export const DEFER_TOOL_OUTPUT_BYTES = 32 * 1024

export function isDeferredToolOutput(value: unknown): value is DeferredToolOutput {
  if (typeof value !== 'object' || value === null) return false
  const ref = (value as DeferredToolOutput).$deferredToolResult
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof ref.topicId === 'string' &&
    !!ref.topicId &&
    typeof ref.messageId === 'string' &&
    !!ref.messageId &&
    typeof ref.toolCallId === 'string' &&
    !!ref.toolCallId
  )
}

/**
 * Measures by serializing, because the value gets serialized for IPC anyway — this adds no work
 * the boundary was not already going to do.
 *
 * The wire size is UTF-8, so `String.length` (UTF-16 code units) undercounts anything non-ASCII —
 * CJK is one code unit but three bytes. Code-unit length is still a valid *lower* bound on the byte
 * count, so it short-circuits the common case for free and the encode only runs on strings already
 * known to be under the threshold.
 */
export function shouldDeferToolOutput(output: unknown): boolean {
  if (output === undefined || output === null) return false
  if (isDeferredToolOutput(output)) return false
  try {
    const serialized = JSON.stringify(output)
    if (serialized === undefined) return false
    if (serialized.length > DEFER_TOOL_OUTPUT_BYTES) return true
    return new TextEncoder().encode(serialized).length > DEFER_TOOL_OUTPUT_BYTES
  } catch {
    return false
  }
}

/** Returns the reference when `output` is too large to send, otherwise `output` untouched. */
export function deferToolOutput(output: unknown, ref: DeferredToolResultRef): unknown {
  if (!shouldDeferToolOutput(output)) return output
  return { $deferredToolResult: ref } satisfies DeferredToolOutput
}
