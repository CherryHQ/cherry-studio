import type { TextTokenizer } from '@main/ai/tokens/textTokenizer'

/** Depth cap — a legitimately deep (~10k) JSON must not blow the stack or `JSON.stringify`. */
const MAX_DEPTH = 8
/** Strings longer than this are treated as an inline media payload, not tokenized verbatim. */
const MAX_STRING_CHARS = 8_192
/** Flat cost for one oversize (likely base64 media) string — bounded, never its full length. */
const OVERSIZE_STRING_TOKENS = 1_500

/**
 * Last-resort token estimate over a raw, loosely-validated request body when the converter
 * itself throws (malformed blocks in `content: z.unknown()` / untyped `tools`).
 *
 * Bounded and total: it walks the body with a depth cap (so a deep object can't make
 * `JSON.stringify` throw a `RangeError`) and prices any oversize string as a small constant
 * rather than re-tokenizing a multi-MB base64 media payload as text. A rough number, but it
 * keeps `count_tokens` from 500-ing or restoring the million-token base64 miscount.
 */
export function boundedBodyTokens(body: unknown, tokenizer: TextTokenizer): number {
  return walk(body, tokenizer, 0)
}

function walk(value: unknown, tokenizer: TextTokenizer, depth: number): number {
  if (depth > MAX_DEPTH) return 0
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? OVERSIZE_STRING_TOKENS : tokenizer.count(value)
  }
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) total += walk(item, tokenizer, depth + 1)
    return total
  }
  if (value && typeof value === 'object') {
    let total = 0
    for (const item of Object.values(value)) total += walk(item, tokenizer, depth + 1)
    return total
  }
  return 0
}
