/** Cross-process wire contract for tool results resolved on demand through `ai.tool.get_result`. */
import * as z from 'zod'

/** Where a deferred tool result can be fetched from. */
export interface DeferredToolResultRef {
  topicId: string
  messageId: string
  toolCallId: string
  /** Identifies the projected value so a replacement invalidates renderer caches. */
  revision?: string
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

const deferredToolOutputSchema: z.ZodType<DeferredToolOutput> = z.object({
  $deferredToolResult: z.object({
    topicId: z.string().min(1),
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    revision: z.string().optional()
  }),
  excerpt: z.object({ head: z.string(), tail: z.string(), totalChars: z.number(), totalLines: z.number() }).optional(),
  skeleton: z.unknown().optional()
})

export function isDeferredToolOutput(value: unknown): value is DeferredToolOutput {
  try {
    return deferredToolOutputSchema.safeParse(value).success
  } catch {
    return false
  }
}
