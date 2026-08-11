import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'

/** Depth cap — a legitimately deep (~10k) JSON must not blow the stack or `JSON.stringify`. */
const MAX_DEPTH = 8
/** Tokenize long strings from a sample this size and extrapolate — bounded work on multi-MB text. */
const TEXT_SAMPLE_CHARS = 8_192
/** Flat cost for one inline media payload (data URL / base64 under a `data` key) — never its length. */
const MEDIA_PAYLOAD_TOKENS = 1_500
/** Base64 alphabet over the head of a long `data` string — how inline media payloads look. */
const BASE64_HEAD = /^[A-Za-z0-9+/=\r\n]+$/

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
  return walk(body, tokenizer, 0, undefined)
}

/**
 * A data URL, or a long base64 blob under the `data` key media blocks use
 * (anthropic `source.data`, gemini `inlineData.data`). Anything else — however long —
 * is ordinary text and must be estimated as text.
 */
function isMediaPayload(value: string, key: string | undefined): boolean {
  if (value.startsWith('data:') && value.includes(';base64,')) return true
  return key === 'data' && value.length > TEXT_SAMPLE_CHARS && BASE64_HEAD.test(value.slice(0, 256))
}

function stringTokens(value: string, tokenizer: TextTokenizer): number {
  if (value.length <= TEXT_SAMPLE_CHARS) return tokenizer.count(value)
  return Math.round((tokenizer.count(value.slice(0, TEXT_SAMPLE_CHARS)) * value.length) / TEXT_SAMPLE_CHARS)
}

function walk(value: unknown, tokenizer: TextTokenizer, depth: number, key: string | undefined): number {
  if (depth > MAX_DEPTH) return 0
  if (typeof value === 'string') {
    return isMediaPayload(value, key) ? MEDIA_PAYLOAD_TOKENS : stringTokens(value, tokenizer)
  }
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) total += walk(item, tokenizer, depth + 1, key)
    return total
  }
  if (value && typeof value === 'object') {
    let total = 0
    for (const [childKey, item] of Object.entries(value)) total += walk(item, tokenizer, depth + 1, childKey)
    return total
  }
  return 0
}
