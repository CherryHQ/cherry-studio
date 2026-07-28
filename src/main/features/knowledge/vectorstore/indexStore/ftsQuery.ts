/**
 * Free-text → FTS query helpers for the trigram-tokenized `search_text_fts`.
 *
 * The `trigram` tokenizer indexes 3-character windows, which drives two rules:
 *
 *  - A quoted multi-character string is a *phrase* of trigrams, i.e. a contiguous
 *    substring demand. Latin text is space-delimited so its tokens are already
 *    words, but a CJK run carries no spaces — `extractFtsTokens` returns a whole
 *    clause as one token, and quoting that would demand the entire clause verbatim.
 *    CJK runs are therefore windowed into overlapping trigrams
 *    ({@link extractMatchTerms}), the tokenizer's own unit.
 *  - Terms shorter than 3 characters produce no trigram and can never MATCH. They
 *    are dropped from the query; only when a query has tokens but *no* term long
 *    enough to index (a bare 1–2 char CJK word like 「天气」) does the store fall
 *    back to a LIKE substring scan ({@link needsLikeFallback} /
 *    {@link toFtsLikePattern}) — decision A3; a real CJK tokenizer is left to v2.x.
 *
 * Terms are OR-ed, not AND-ed: a natural-language question ("公司的报销流程是什么",
 * "how to configure proxy timeout") carries filler its target chunk does not
 * contain, so requiring every term returns nothing. OR lets bm25() rank by how many
 * and how rare the matched terms are, which is what the score is for.
 */

/** Minimum token length the trigram tokenizer can index. */
const TRIGRAM_MIN_TOKEN_LENGTH = 3

/**
 * Characters from scripts that do not delimit words with spaces, so a run of them
 * is a clause rather than a word and must be windowed into trigrams.
 */
const UNSEGMENTED_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * Cap on MATCH terms per query. A long CJK question yields one trigram per
 * character, so this bounds the FTS work a single search can trigger.
 */
const MAX_MATCH_TERMS = 64

/** Extract word/number tokens (Unicode letters, numbers, underscore) from free user text. */
export function extractFtsTokens(query: string): string[] {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? []
}

/**
 * Split one extracted token into the strings actually sent to MATCH: space-delimited
 * runs pass through whole (they are already words), while unsegmented (CJK) runs
 * longer than a trigram are windowed into overlapping trigrams.
 */
function toMatchTerms(token: string): string[] {
  const chars = [...token]
  const terms: string[] = []
  let cursor = 0

  while (cursor < chars.length) {
    const isUnsegmented = UNSEGMENTED_SCRIPT_PATTERN.test(chars[cursor])
    let end = cursor + 1
    while (end < chars.length && UNSEGMENTED_SCRIPT_PATTERN.test(chars[end]) === isUnsegmented) {
      end += 1
    }

    const run = chars.slice(cursor, end)
    if (!isUnsegmented || run.length <= TRIGRAM_MIN_TOKEN_LENGTH) {
      terms.push(run.join(''))
    } else {
      for (let start = 0; start + TRIGRAM_MIN_TOKEN_LENGTH <= run.length; start += 1) {
        terms.push(run.slice(start, start + TRIGRAM_MIN_TOKEN_LENGTH).join(''))
      }
    }

    cursor = end
  }

  return terms
}

/**
 * The distinct trigram-indexable terms a free-text query contributes to MATCH,
 * capped at {@link MAX_MATCH_TERMS}. Empty when nothing in the query can be indexed.
 */
export function extractMatchTerms(query: string): string[] {
  const terms = extractFtsTokens(query)
    .flatMap(toMatchTerms)
    .filter((term) => [...term].length >= TRIGRAM_MIN_TOKEN_LENGTH)
  return [...new Set(terms)].slice(0, MAX_MATCH_TERMS)
}

/**
 * Build an FTS5 MATCH query: quote each term (escaping embedded quotes) and OR them
 * together. Returns null when the text yields no indexable term — the caller then
 * routes to the LIKE fallback (see {@link needsLikeFallback}).
 */
export function toFtsMatchQuery(query: string): string | null {
  const terms = extractMatchTerms(query)
  if (terms.length === 0) {
    return null
  }
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}

/**
 * True when the query has tokens but none of them survives as a trigram-indexable
 * term, so MATCH would silently return nothing. Only then does the store pay for a
 * LIKE substring scan — a query with at least one indexable term takes the ranked
 * MATCH path, and its too-short terms are simply dropped.
 */
export function needsLikeFallback(query: string): boolean {
  return extractFtsTokens(query).length > 0 && extractMatchTerms(query).length === 0
}

/**
 * `%`-wrapped LIKE pattern matching `token` as a literal substring. Escapes the
 * LIKE wildcards (`%`, `_`) and the escape char itself; use with `ESCAPE '\'`.
 */
export function toFtsLikePattern(token: string): string {
  const escaped = token.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}
