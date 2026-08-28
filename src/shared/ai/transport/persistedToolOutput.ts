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

/** One persisted blob: a FileManager entry + its excerpt + the JSON-pointer-lite
 *  key naming the skeleton field the text belongs to (`""` for whole-output
 *  single-blob shapes, `"/<i>/content"` / `"/text"` for structured ones). */
export interface PersistedToolOutputBlobRef {
  key: string
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
}

/** Single-blob envelope (v1 — shipped data; field set is frozen). */
export interface PersistedToolOutputSingleRef {
  fileEntryId: string
  vfsFilename: string
  head: string
  tail: string
  totalChars: number
  totalLines: number
  /** `'text'` = output was a plain string; `'mcp-content'` = MCP
   *  `{ content: [{type:'text',...}], metadata? }` envelope. */
  shape: 'text' | 'mcp-content'
  /** Retained MCP `metadata` for `'mcp-content'` reconstruction. */
  metadata?: unknown
}

/** Multi-blob envelope (v2): a structured output whose oversized entity texts
 *  moved to blobs. The skeleton keeps every identity/citation field (plus an
 *  inline snippet per blobbed field), so citations render without any blob
 *  read and the envelope inflates without the codec that produced it. */
export interface PersistedToolOutputEntitiesRef {
  shape: 'entities'
  skeleton: unknown
  blobRefs: PersistedToolOutputBlobRef[]
}

export type PersistedToolOutputRef = PersistedToolOutputSingleRef | PersistedToolOutputEntitiesRef

/** Replaces a tool part's `output` in `message.data` when the full value was
 *  offloaded to FileManager entries. */
export interface PersistedToolOutput {
  $persistedToolOutput: PersistedToolOutputRef
}

/** The `$persistedToolOutput` key is a sentinel only our own trimmer writes,
 *  so its presence is the whole discriminant — no field validation. */
export function isPersistedToolOutput(value: unknown): value is PersistedToolOutput {
  if (typeof value !== 'object' || value === null) return false
  const ref = (value as PersistedToolOutput).$persistedToolOutput
  return typeof ref === 'object' && ref !== null
}

/** Uniform blob view over both envelope generations (single-blob → one entry, key `""`). */
export function blobRefsOf(ref: PersistedToolOutputRef): PersistedToolOutputBlobRef[] {
  if (ref.shape === 'entities') return ref.blobRefs
  const { fileEntryId, vfsFilename, head, tail, totalChars, totalLines } = ref
  return [{ key: '', fileEntryId, vfsFilename, head, tail, totalChars, totalLines }]
}

/** One display excerpt per envelope for transport/renderer preview — head of the
 *  first blob, tail of the last, summed totals. Keeps the outbound projection
 *  and the renderer excerpt path shape-agnostic. */
export function envelopeDisplayExcerpt(ref: PersistedToolOutputRef): {
  head: string
  tail: string
  totalChars: number
  totalLines: number
} {
  const blobs = blobRefsOf(ref)
  return {
    head: blobs[0].head,
    tail: blobs[blobs.length - 1].tail,
    totalChars: blobs.reduce((sum, b) => sum + b.totalChars, 0),
    totalLines: blobs.reduce((sum, b) => sum + b.totalLines, 0)
  }
}
