/**
 * Shared tool-output codec factories (see `ToolOutputCodec` in
 * `adapters/aiSdk/types.ts`): structure-aware trimming splits an output into
 * an identity skeleton + per-entity content blobs, so the truncate/persist
 * layers can trim bulk content without ever touching citation anchors.
 *
 * - `makeEntitiesCodec` — outputs shaped `[{…identity, [contentKey]: string}]`
 *   (web_search / web_fetch / kb_search results). Each entity's content is one
 *   blob keyed `"/<index>/<contentKey>"`; everything else rides the skeleton.
 * - `makeTextFieldCodec` — single-record outputs with one bulk text field
 *   (fs_read / read_file echoes). One blob keyed `"/<textKey>"`.
 *
 * `assemble` clones shallowly and preserves key insertion order — the
 * assembled value is stringified into the prompt on both lanes and must be
 * byte-stable for prefix caching.
 */

import type { ToolOutputCodec } from './adapters/aiSdk/types'

/** Persist-lane inline stand-in for a blobbed content field. Byte-aligned with
 *  the renderer citation snippet (`toSnippet` in citations.ts). */
const SNIPPET_MAX_CHARS = 300

function snippet(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= SNIPPET_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…`
}

/** Codec for entity-array outputs: `[{…identity, [contentKey]: string}, …]`. */
export function makeEntitiesCodec({ contentKey }: { contentKey: string }): ToolOutputCodec {
  return {
    deflate(value) {
      if (!Array.isArray(value) || value.length === 0) return null
      const blobs: Array<{ key: string; text: string }> = []
      for (let index = 0; index < value.length; index++) {
        const item = value[index]
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
        const content = (item as Record<string, unknown>)[contentKey]
        if (typeof content !== 'string') return null
        blobs.push({ key: `/${index}/${contentKey}`, text: content })
      }
      return { skeleton: value, blobs }
    },
    assemble(skeleton, texts) {
      const items = skeleton as Array<Record<string, unknown>>
      return items.map((item, index) => {
        const key = `/${index}/${contentKey}`
        if (!(key in texts) || texts[key] === item[contentKey]) return item
        const clone: Record<string, unknown> = {}
        for (const k of Object.keys(item)) clone[k] = k === contentKey ? texts[key] : item[k]
        return clone
      })
    },
    snippet
  }
}

/** Codec for single-record outputs with one bulk text field (read-tool echoes). */
export function makeTextFieldCodec({ textKey }: { textKey: string }): ToolOutputCodec {
  return {
    deflate(value) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      const text = (value as Record<string, unknown>)[textKey]
      if (typeof text !== 'string') return null
      return { skeleton: value, blobs: [{ key: `/${textKey}`, text }] }
    },
    assemble(skeleton, texts) {
      const record = skeleton as Record<string, unknown>
      const key = `/${textKey}`
      if (!(key in texts) || texts[key] === record[textKey]) return record
      const clone: Record<string, unknown> = {}
      for (const k of Object.keys(record)) clone[k] = k === textKey ? texts[key] : record[k]
      return clone
    },
    snippet
  }
}
