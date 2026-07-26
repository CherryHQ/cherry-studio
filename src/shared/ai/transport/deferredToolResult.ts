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
 * Results at or below this travel inline. Tuned so ordinary tool cards (web search, knowledge
 * search, a small file read) are unaffected and only genuinely heavy payloads defer.
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
 * ponytail: measures by serializing, because the value gets serialized for IPC anyway — this adds
 * no work that the boundary was not already going to do. If profiling ever shows it hot, swap in
 * an estimator that bails out once it passes the threshold.
 */
export function shouldDeferToolOutput(output: unknown): boolean {
  if (output === undefined || output === null) return false
  if (isDeferredToolOutput(output)) return false
  try {
    return JSON.stringify(output).length > DEFER_TOOL_OUTPUT_BYTES
  } catch {
    return false
  }
}

/** Returns the reference when `output` is too large to send, otherwise `output` untouched. */
export function deferToolOutput(output: unknown, ref: DeferredToolResultRef): unknown {
  if (!shouldDeferToolOutput(output)) return output
  return { $deferredToolResult: ref } satisfies DeferredToolOutput
}
