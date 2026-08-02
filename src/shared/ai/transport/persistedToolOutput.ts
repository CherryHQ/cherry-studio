/**
 * Persist-level trimming of oversized tool results: at persist time the full
 * output moves into a FileManager entry and the tool part's `output` in
 * `message.data` is replaced by this envelope (head/tail excerpt + the entry
 * reference). The blob is the ONLY full copy — a `chat_message_file_ref` row
 * with role `'tool_output'` keeps it alive until the message is deleted.
 *
 * Distinct from `deferredToolResult.ts`, which is transport-only (DB keeps the
 * full output; the renderer refetches). Here the DB itself holds the excerpt.
 * Imported by both processes.
 */

/** Excerpt sizes — must match the in-flight middleware (contextBuild.ts) so
 *  persisted excerpts are byte-identical to in-flight markers. */
export const PERSIST_HEAD_CHARS = 500
export const PERSIST_TAIL_CHARS = 1000

export interface PersistedToolOutputRef {
  /** FileManager entry holding the full text. */
  fileEntryId: string
  /** Content-addressed vfs filename (`vfs_<sha256[:16]>.txt`) — keeps the
   *  marker URI byte-identical with the in-flight offload path. */
  vfsFilename: string
  /** Line-snapped excerpts (see `computeHeadTailExcerpt`). */
  head: string
  tail: string
  totalChars: number
  totalLines: number
  /** How to reconstruct the original output shape from the full text:
   *  `'text'` = output was a plain string; `'mcp-content'` = MCP
   *  `{ content: [{type:'text',...}], metadata? }` envelope. */
  shape: 'text' | 'mcp-content'
  /** Retained MCP `metadata` for `'mcp-content'` reconstruction. */
  metadata?: unknown
}

/** Replaces a tool part's `output` in `message.data` when the full value was
 *  offloaded to a FileManager entry. */
export interface PersistedToolOutput {
  $persistedToolOutput: PersistedToolOutputRef
}

export function isPersistedToolOutput(value: unknown): value is PersistedToolOutput {
  if (typeof value !== 'object' || value === null) return false
  const ref = (value as PersistedToolOutput).$persistedToolOutput
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof ref.fileEntryId === 'string' &&
    !!ref.fileEntryId &&
    typeof ref.vfsFilename === 'string' &&
    !!ref.vfsFilename &&
    typeof ref.head === 'string' &&
    typeof ref.tail === 'string' &&
    typeof ref.totalChars === 'number' &&
    typeof ref.totalLines === 'number' &&
    (ref.shape === 'text' || ref.shape === 'mcp-content')
  )
}
