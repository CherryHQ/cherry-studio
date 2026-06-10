/**
 * Build an FTS5 MATCH query from free user text: extract word/number tokens,
 * quote each (escaping embedded quotes) and AND them together. Returns null when
 * the text yields no usable token — the caller treats that as "no BM25 hits".
 *
 * With the `trigram` tokenizer this matches substrings, but a query token shorter
 * than 3 characters produces no trigram and so matches nothing; a LIKE fallback
 * for very short (e.g. CJK) queries is future work — see
 * knowledge-technical-design.md §15.3 / decision A3. Mirrors the token handling
 * of the legacy LibSQLVectorStore so BM25 behavior carries over unchanged.
 */
export function toFtsMatchQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)
  if (!tokens) {
    return null
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
}
