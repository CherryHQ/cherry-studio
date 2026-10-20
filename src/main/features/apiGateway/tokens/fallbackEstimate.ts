import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'

/** Depth cap — a legitimately deep (~10k) JSON must not blow the stack or `JSON.stringify`. */
const MAX_DEPTH = 8
/** Tokenize long strings from a sample this size and extrapolate — bounded work on multi-MB text. */
const TEXT_SAMPLE_CHARS = 8_192
/** Flat cost for one inline media payload — never its base64 length. */
const MEDIA_PAYLOAD_TOKENS = 1_500

/**
 * Last-resort token estimate over a raw, loosely-validated request body when the converter
 * itself throws (malformed blocks in `content: z.unknown()` / untyped `tools`).
 *
 * Bounded and total: it walks the body with a depth cap (so a deep object can't make
 * `JSON.stringify` throw a `RangeError`), prices inline media as a small constant, and
 * estimates long ordinary text by sampling + linear extrapolation — a 100k-char prompt must
 * count as text, not as one media constant, or the client defers compaction and then hits
 * the downstream context limit.
 */
export function boundedBodyTokens(body: unknown, tokenizer: TextTokenizer): number {
  return walk(body, tokenizer, 0, undefined, undefined)
}

/**
 * A data URL, or the `data` field of a known inline-media carrier: anthropic
 * `{type:'base64', media_type, data}`, gemini `inlineData` `{mimeType, data}`, AI SDK
 * `{mediaType, data}` items. The key name alone is NOT a media signal — a plain field
 * that happens to be called `data` (tool input, DNA text, encoded logs) is ordinary text
 * and must be estimated as text.
 */
function isMediaPayload(value: string, key: string | undefined, parent: Record<string, unknown> | undefined): boolean {
  if (value.startsWith('data:') && value.includes(';base64,')) return true
  if (key !== 'data' || !parent) return false
  return (
    parent.type === 'base64' ||
    typeof parent.media_type === 'string' ||
    typeof parent.mimeType === 'string' ||
    typeof parent.mediaType === 'string'
  )
}

function stringTokens(value: string, tokenizer: TextTokenizer): number {
  if (value.length <= TEXT_SAMPLE_CHARS) return tokenizer.count(value)
  return Math.round((tokenizer.count(value.slice(0, TEXT_SAMPLE_CHARS)) * value.length) / TEXT_SAMPLE_CHARS)
}

function walk(
  value: unknown,
  tokenizer: TextTokenizer,
  depth: number,
  key: string | undefined,
  parent: Record<string, unknown> | undefined
): number {
  if (depth > MAX_DEPTH) return 0
  if (typeof value === 'string') {
    return isMediaPayload(value, key, parent) ? MEDIA_PAYLOAD_TOKENS : stringTokens(value, tokenizer)
  }
  if (Array.isArray(value)) {
    let total = 0
    // Array items lose the object context on purpose: `{data: ['…']}` is not a media carrier.
    for (const item of value) total += walk(item, tokenizer, depth + 1, undefined, undefined)
    return total
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    let total = 0
    for (const [childKey, item] of Object.entries(record)) total += walk(item, tokenizer, depth + 1, childKey, record)
    return total
  }
  return 0
}
