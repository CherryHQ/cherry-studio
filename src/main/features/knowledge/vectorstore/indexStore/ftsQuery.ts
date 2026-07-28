/**
 * Free-text → FTS query helpers for the trigram-tokenized `search_text_fts`.
 *
 * The `trigram` tokenizer indexes 3-character windows, which drives how a query
 * is compiled:
 *
 *  - A quoted multi-character string is a *phrase* of trigrams, i.e. a contiguous
 *    substring demand. Space-delimited tokens are already words, but a CJK run
 *    carries no spaces — `extractFtsTokens` returns a whole clause as one token,
 *    and quoting that would demand the entire clause verbatim. CJK runs are
 *    therefore windowed into overlapping trigrams ({@link extractMatchTerms}),
 *    the tokenizer's own unit.
 *  - Indexable terms are OR-ed, not AND-ed: a natural-language question
 *    ("公司的报销流程是什么", "how to configure proxy timeout") carries filler its
 *    target chunk does not contain, so requiring every term returns nothing. OR
 *    lets bm25() rank by how many and how rare the matched terms are.
 *  - Terms shorter than 3 characters produce no trigram and can never MATCH, but
 *    they are often the query's content words — 2-character words dominate
 *    Chinese (「系统」「年假」) — so they must not vanish from the query's
 *    semantics. The store ANDs a `LIKE '%term%'` filter per short term onto the
 *    ranked MATCH ({@link extractShortTerms}), relaxing the filters when they
 *    eliminate every candidate (a filler 'to' need not literally occur in the
 *    target chunk). Only when *nothing* in the query is indexable (a bare
 *    「天气」) does it fall back to a pure LIKE scan ({@link needsLikeFallback} /
 *    {@link toFtsLikePattern}) — decision A3.
 *
 * Known tradeoffs, accepted until a real CJK tokenizer replaces trigram in v2.x:
 *
 *  - OR has no minimum-should-match, so chunks sharing only filler trigrams
 *    (「是什么」) enter the candidate set. bm25() ranks the real answer far above
 *    them, but for a BM25-only base there is no downstream relevance gate
 *    (`applyRelevanceThreshold` skips 'ranking' scores and pure bm25 mode has no
 *    RRF), so weak matches can pad the tail up to topK.
 *  - Windowing covers Han/Hiragana/Katakana only. Thai, Lao, Khmer and Myanmar
 *    are space-less too but are NOT windowed — their clauses keep the
 *    exact-substring semantics; supporting them is deferred with the tokenizer.
 */
import { loggerService } from '@logger'

const logger = loggerService.withContext('KnowledgeFtsQuery')

/** Minimum token length the trigram tokenizer can index. */
const TRIGRAM_MIN_TOKEN_LENGTH = 3

/**
 * Characters of the scripts windowed into trigrams: Han, Hiragana, Katakana.
 * `Script_Extensions`, not `Script`: shared marks these scripts use mid-word —
 * ー ｰ 々 〆 ヽ ゝ — are `Script=Common`, so plain `Script=` would terminate a
 * run at every ー, splitting サーバー into fragments too short to index.
 */
const UNSEGMENTED_SCRIPT_PATTERN =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u

/**
 * Cap on MATCH terms per query. Bounds the term *count* a long CJK question can
 * contribute (each character past the second adds a trigram), not the size of
 * any one term. Whole words rank ahead of trigram windows in
 * {@link extractMatchTerms}, so the cap sheds the tail of a long clause rather
 * than a rare word ("Kubernetes") sitting at the end of the question.
 */
const MAX_MATCH_TERMS = 64

/** Count of Unicode code points (what the trigram tokenizer windows over). */
const charCount = (term: string): number => [...term].length

/** Extract word/number tokens (Unicode letters, numbers, underscore) from free user text. */
export function extractFtsTokens(query: string): string[] {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? []
}

/**
 * Split the query's tokens into the units MATCH can quote: space-delimited runs
 * stay whole in `words` (they are already words, as are CJK runs at or below
 * trigram length), while longer unsegmented (CJK) runs are windowed into
 * overlapping trigrams.
 */
function splitQuery(query: string): { words: string[]; trigrams: string[] } {
  const words: string[] = []
  const trigrams: string[] = []

  for (const token of extractFtsTokens(query)) {
    const chars = [...token]
    let cursor = 0

    while (cursor < chars.length) {
      const isUnsegmented = UNSEGMENTED_SCRIPT_PATTERN.test(chars[cursor])
      let end = cursor + 1
      while (end < chars.length && UNSEGMENTED_SCRIPT_PATTERN.test(chars[end]) === isUnsegmented) {
        end += 1
      }

      const run = chars.slice(cursor, end)
      if (!isUnsegmented || run.length <= TRIGRAM_MIN_TOKEN_LENGTH) {
        words.push(run.join(''))
      } else {
        for (let start = 0; start + TRIGRAM_MIN_TOKEN_LENGTH <= run.length; start += 1) {
          trigrams.push(run.slice(start, start + TRIGRAM_MIN_TOKEN_LENGTH).join(''))
        }
      }

      cursor = end
    }
  }

  return { words, trigrams }
}

/**
 * The distinct trigram-indexable terms a free-text query contributes to MATCH —
 * whole words first, then trigram windows, capped at {@link MAX_MATCH_TERMS}.
 * Empty when nothing in the query can be indexed.
 */
export function extractMatchTerms(query: string): string[] {
  const { words, trigrams } = splitQuery(query)
  const distinct = [...new Set([...words.filter((word) => charCount(word) >= TRIGRAM_MIN_TOKEN_LENGTH), ...trigrams])]
  if (distinct.length > MAX_MATCH_TERMS) {
    logger.warn('BM25 query exceeds the MATCH term cap; shedding the tail', {
      terms: distinct.length,
      cap: MAX_MATCH_TERMS
    })
  }
  return distinct.slice(0, MAX_MATCH_TERMS)
}

/**
 * The distinct terms too short to produce a trigram (2-character CJK words,
 * "to", "Go"). MATCH can never see them, but they are often the query's content
 * words — dropping 「系统」 from 「系统 architecture」 would silently turn the
 * query into a bare `MATCH "architecture"`. The store ANDs a `LIKE '%term%'`
 * filter per short term onto the MATCH query instead ({@link toFtsLikePattern}),
 * relaxed when the filters leave no candidate at all.
 */
export function extractShortTerms(query: string): string[] {
  const { words } = splitQuery(query)
  return [...new Set(words.filter((word) => charCount(word) < TRIGRAM_MIN_TOKEN_LENGTH))]
}

/**
 * Build an FTS5 MATCH query: quote each term (escaping embedded quotes) and OR
 * them together. Returns null when the text yields no indexable term — the caller
 * then routes to the LIKE fallback (see {@link needsLikeFallback}).
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
 * MATCH path, keeping its short terms as LIKE filters ({@link extractShortTerms}).
 */
export function needsLikeFallback(query: string): boolean {
  const { words, trigrams } = splitQuery(query)
  if (words.length === 0 && trigrams.length === 0) {
    return false
  }
  return trigrams.length === 0 && !words.some((word) => charCount(word) >= TRIGRAM_MIN_TOKEN_LENGTH)
}

/**
 * `%`-wrapped LIKE pattern matching `token` as a literal substring. Escapes the
 * LIKE wildcards (`%`, `_`) and the escape char itself; use with `ESCAPE '\'`.
 */
export function toFtsLikePattern(token: string): string {
  const escaped = token.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}
