/**
 * Durable storage for oversized tool-result text (#16786).
 *
 * The full text of a trimmed tool output lives in a FileManager internal
 * entry with `cleanupPolicy: 'delete_when_unreferenced'`; a
 * `chat_message_file_ref` row (role `'tool_output'`) ties its lifetime to the
 * referencing message. Entries are deduplicated by `contentHash` so the same
 * output re-persisted across turns / regenerate siblings is stored once.
 *
 * Shared by the persist-time trimmer and the in-flight middleware storage
 * adapter so both lanes converge on the same entry (and thus the same marker
 * bytes — provider prefix caches survive).
 */

import { createHash } from 'node:crypto'

import { application } from '@application'
import { hashContent } from '@main/utils/file'
import type { PersistedToolOutputEntitiesRef, PersistedToolOutputSingleRef } from '@shared/ai/transport'
import type { FileEntry } from '@shared/data/types/file'

export interface PersistedBlob {
  entry: FileEntry
  /** Content-addressed marker filename (`vfs_<sha256[:16]>.txt`) — byte-identical
   *  to the in-flight offloader's `_generateFilename`. */
  vfsFilename: string
}

/** Mirror of the offloader's content-addressed naming (sha256 hex, first 16). */
export function computeVfsFilename(text: string): string {
  const sha = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
  return `vfs_${sha}.txt`
}

/**
 * Find-or-create the FileManager entry holding `text`. Dedup key is the
 * stored `contentHash` (xxh3, indexed); candidates are narrowed to entries
 * this module could have written (internal auto-cleanup `.txt` of the same
 * size) so an unrelated user file with colliding content is never adopted.
 */
export async function persistToolOutputText(text: string): Promise<PersistedBlob> {
  const vfsFilename = computeVfsFilename(text)
  const data = Buffer.from(text, 'utf8')
  const fileManager = application.get('FileManager')

  const candidates = await fileManager.findInternalByContentHash(hashContent(data))
  const match = candidates.find(
    (c) =>
      c.origin === 'internal' &&
      c.cleanupPolicy === 'delete_when_unreferenced' &&
      c.ext === 'txt' &&
      c.size === data.byteLength
  )
  if (match) return { entry: match, vfsFilename }

  const entry = await fileManager.createInternalEntry({
    source: 'bytes',
    data,
    name: vfsFilename.replace(/\.txt$/, ''),
    ext: 'txt',
    cleanupPolicy: 'delete_when_unreferenced'
  })
  return { entry, vfsFilename }
}

export interface PersistableText {
  text: string
  shape: PersistedToolOutputSingleRef['shape']
  metadata?: unknown
}

/**
 * Text projection of a tool output eligible for persist-time trimming.
 *
 * v1 scope (deliberately narrow): plain string outputs, and MCP result
 * envelopes whose `content` is exclusively text blocks. The extracted text is
 * byte-identical to what `mcpResultToTextSummary` feeds the model, so the
 * rendered marker matches the in-flight truncation of the same output.
 * Anything else (structured JSON, multimodal MCP content, unknown sibling
 * fields that reconstruction would drop) returns `null` — the output stays
 * full in the DB and the in-flight middleware keeps truncating it per
 * request.
 */
export function extractPersistableText(output: unknown): PersistableText | null {
  if (typeof output === 'string') return { text: output, shape: 'text' }
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return null

  const record = output as Record<string, unknown>
  if (record.isError) return null
  // Reconstruction rebuilds only `content` + `metadata`; any other sibling
  // field would be silently lost, so its presence disqualifies the output.
  for (const key of Object.keys(record)) {
    if (key !== 'content' && key !== 'metadata' && key !== 'isError') return null
  }

  const content = record.content
  if (!Array.isArray(content) || content.length === 0) return null
  const texts: string[] = []
  for (const item of content) {
    if (typeof item !== 'object' || item === null) return null
    const block = item as Record<string, unknown>
    if (block.type !== 'text') return null
    if (block.text !== undefined && typeof block.text !== 'string') return null
    texts.push(block.text || '')
  }
  // '\n' join matches mcpResultToTextSummary for all-text content.
  return { text: texts.join('\n'), shape: 'mcp-content', metadata: record.metadata }
}

/**
 * Rebuild a tool output from its persisted envelope + the full text read back
 * from FileManager. `'mcp-content'` collapses the original text blocks into
 * one — the model-facing summary (`'\n'` join) and the rendered text are
 * unchanged by that. Single-blob (v1) shapes only; entities inflate via
 * {@link inflateEntities}.
 */
export function reconstructOutput(ref: PersistedToolOutputSingleRef, fullText: string): unknown {
  if (ref.shape === 'text') return fullText
  return {
    content: [{ type: 'text', text: fullText }],
    ...(ref.metadata !== undefined ? { metadata: ref.metadata } : {})
  }
}

/**
 * Splice `text` into a shallow clone of `skeleton` at a JSON-pointer-lite
 * `key` (`"/<index>/<field>"` or `"/<field>"`), preserving key insertion
 * order. Generic on the key so stored envelopes inflate without the codec
 * that produced them; unknown keys leave the skeleton untouched.
 */
export function spliceTextAtKey(skeleton: unknown, key: string, text: string): unknown {
  const segments = key.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return skeleton

  const replaceField = (record: Record<string, unknown>, field: string): Record<string, unknown> => {
    if (!(field in record)) return record
    const clone: Record<string, unknown> = {}
    for (const k of Object.keys(record)) clone[k] = k === field ? text : record[k]
    return clone
  }

  if (segments.length === 1) {
    if (typeof skeleton !== 'object' || skeleton === null || Array.isArray(skeleton)) return skeleton
    return replaceField(skeleton as Record<string, unknown>, segments[0])
  }
  const index = Number(segments[0])
  if (!Array.isArray(skeleton) || !Number.isInteger(index) || index < 0 || index >= skeleton.length) return skeleton
  const item = skeleton[index]
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return skeleton
  const replaced = replaceField(item as Record<string, unknown>, segments[1])
  if (replaced === item) return skeleton
  const next = [...skeleton]
  next[index] = replaced
  return next
}

/** Inflate an entities envelope: splice each blob's text into the skeleton. */
export function inflateEntities(ref: PersistedToolOutputEntitiesRef, texts: Record<string, string>): unknown {
  let value = ref.skeleton
  for (const blob of ref.blobRefs) {
    if (blob.key in texts) value = spliceTextAtKey(value, blob.key, texts[blob.key])
  }
  return value
}
