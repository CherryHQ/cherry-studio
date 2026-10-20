/** Cross-process wire contract for tool results resolved on demand through `ai.tool.get_result`. */

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
  /** Bounded identity/citation fields carried when available, either from a
   *  persisted entities envelope or derived from an oversized citable output. */
  skeleton?: unknown
}

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
