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

import { isJSONValue, type JSONObject, type JSONValue } from '@ai-sdk/provider'

import { CITATION_SNIPPET_MAX_CHARS } from '@shared/ai/builtinTools'

import type { ToolOutputCodec } from './adapters/aiSdk/types'

function acceptsJsonMetadata(value: unknown): value is JSONValue {
  try {
    return isJSONValue(value)
  } catch {
    // Recursive SDK validation can throw on cyclic or excessively deep metadata.
    return false
  }
}

function snippet(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= CITATION_SNIPPET_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, CITATION_SNIPPET_MAX_CHARS)}…`
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
      return acceptsJsonMetadata(value) ? { skeleton: value, blobs } : null
    },
    assemble(skeleton, texts) {
      // SAFETY: assemble consumes the JSON entity array accepted by this codec's deflate.
      const items = skeleton as JSONObject[]
      return items.map((item, index) => {
        const key = `/${index}/${contentKey}`
        if (!(key in texts) || texts[key] === item[contentKey]) return item
        const clone: JSONObject = {}
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
      return acceptsJsonMetadata(value) ? { skeleton: value, blobs: [{ key: `/${textKey}`, text }] } : null
    },
    assemble(skeleton, texts) {
      // SAFETY: assemble consumes the JSON record accepted by this codec's deflate.
      const record = skeleton as JSONObject
      const key = `/${textKey}`
      if (!(key in texts) || texts[key] === record[textKey]) return record
      const clone: JSONObject = {}
      for (const k of Object.keys(record)) clone[k] = k === textKey ? texts[key] : record[k]
      return clone
    },
    snippet
  }
}
