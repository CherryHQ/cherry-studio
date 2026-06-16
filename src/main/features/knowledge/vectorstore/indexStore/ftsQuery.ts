/**
 * Free-text → FTS query helpers for the trigram-tokenized `search_text_fts`.
 *
 * The `trigram` tokenizer only indexes tokens of 3+ characters, so a query token
 * shorter than that (notably 1–2 character CJK words like 「天气」「系统」) produces
 * no trigram and a MATCH would silently return nothing. For such queries the
 * store falls back to a LIKE substring scan ({@link needsLikeFallback} /
 * {@link toFtsLikePattern}) — decision A3; only a *real* CJK tokenizer is left to
 * v2.x. MATCH-path token handling mirrors the legacy LibSQLVectorStore so BM25
 * behavior carries over unchanged.
 */

/** Minimum token length the trigram tokenizer can index. */
const TRIGRAM_MIN_TOKEN_LENGTH = 3

/** Extract word/number tokens (Unicode letters, numbers, underscore) from free user text. */
export function extractFtsTokens(query: string): string[] {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? []
}

/**
 * Build an FTS5 MATCH query: quote each token (escaping embedded quotes) and AND
 * them together. Returns null when the text yields no usable token — the caller
 * treats that as "no BM25 hits".
 */
export function toFtsMatchQuery(query: string): string | null {
  const tokens = extractFtsTokens(query)
  if (tokens.length === 0) {
    return null
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
}

/**
 * True when the query has at least one token too short for the trigram tokenizer,
 * so a MATCH would silently miss it. The store then routes the whole query to the
 * LIKE substring fallback (a single short token also poisons an AND of longer
 * ones, so the decision is per-query, not per-token).
 */
export function needsLikeFallback(query: string): boolean {
  return extractFtsTokens(query).some((token) => [...token].length < TRIGRAM_MIN_TOKEN_LENGTH)
}

/**
 * `%`-wrapped LIKE pattern matching `token` as a literal substring. Escapes the
 * LIKE wildcards (`%`, `_`) and the escape char itself; use with `ESCAPE '\'`.
 */
export function toFtsLikePattern(token: string): string {
  const escaped = token.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}
