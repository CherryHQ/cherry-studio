/**
 * Outbound transport policy for tool results: an oversized output is replaced by a reference the
 * renderer resolves on demand through `ai.tool.get_result`. Imported by both processes.
 */

/** Where a deferred tool result can be fetched from. */
export interface DeferredToolResultRef {
  topicId: string
  messageId: string
  toolCallId: string
}

/** Head/tail preview carried alongside a deferred reference so the renderer
 *  can show something meaningful while (or instead of) fetching the full value. */
export interface DeferredToolOutputExcerpt {
  head: string
  tail: string
  totalChars: number
  totalLines: number
}

/** Replaces a tool part's `output` when the real value was too large to send. */
export interface DeferredToolOutput {
  $deferredToolResult: DeferredToolResultRef
  /** Present when the stored output is a persisted excerpt (`$persistedToolOutput`). */
  excerpt?: DeferredToolOutputExcerpt
  /** Present when the persisted envelope is `'entities'`-shaped: the stored
   *  skeleton (identity/citation fields + inline snippets), so citation
   *  extraction works without resolving any blob. */
  skeleton?: unknown
}

/** Serialized UTF-8 size at or below which a result travels inline. */
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

export function shouldDeferToolOutput(output: unknown): boolean {
  if (output === undefined || output === null) return false
  if (isDeferredToolOutput(output)) return false
  try {
    const serialized = JSON.stringify(output)
    if (serialized === undefined) return false
    // UTF-16 code units are a lower bound on UTF-8 bytes, so this short-circuits without encoding.
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
