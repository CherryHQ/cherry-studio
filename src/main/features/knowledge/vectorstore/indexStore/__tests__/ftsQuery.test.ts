import { describe, expect, it } from 'vitest'

import { extractMatchTerms, needsLikeFallback, toFtsLikePattern, toFtsMatchQuery } from '../ftsQuery'

describe('extractMatchTerms', () => {
  it('keeps space-delimited tokens whole — they are already words', () => {
    expect(extractMatchTerms('configure proxy timeout')).toEqual(['configure', 'proxy', 'timeout'])
  })

  it('windows an unsegmented CJK run into overlapping trigrams', () => {
    // The run is a clause, not a word: quoting it whole would make MATCH demand the
    // entire clause as one contiguous substring.
    expect(extractMatchTerms('报销流程')).toEqual(['报销流', '销流程'])
  })

  it('splits a token that mixes Latin and CJK, windowing only the CJK part', () => {
    expect(extractMatchTerms('RAG检索增强')).toEqual(['RAG', '检索增', '索增强'])
  })

  it('drops terms too short to produce a trigram instead of letting them poison the query', () => {
    // 'to' and '天气' cannot be indexed, but the indexable terms must still be searched.
    expect(extractMatchTerms('how to configure')).toEqual(['how', 'configure'])
    expect(extractMatchTerms('the 天气 today')).toEqual(['the', 'today'])
  })

  it('keeps an exactly-3-character run as one term', () => {
    expect(extractMatchTerms('系统统')).toEqual(['系统统'])
  })

  it('de-duplicates repeated terms', () => {
    expect(extractMatchTerms('proxy proxy')).toEqual(['proxy'])
    // Overlapping windows of a repeated clause collapse to the distinct trigrams.
    expect(extractMatchTerms('报销报销')).toEqual(['报销报', '销报销'])
  })

  it('caps the term count so a long CJK question cannot explode the FTS query', () => {
    // 100 distinct Han characters — one trigram per character, none de-duplicated.
    const longQuery = String.fromCodePoint(...Array.from({ length: 100 }, (_, index) => 0x4e00 + index))
    expect(extractMatchTerms(longQuery).length).toBe(64)
  })

  it('is empty when nothing in the text can be indexed', () => {
    expect(extractMatchTerms('')).toEqual([])
    expect(extractMatchTerms('!!! --- ???')).toEqual([])
    expect(extractMatchTerms('天气')).toEqual([])
  })
})

describe('toFtsMatchQuery', () => {
  it('ORs the terms so a natural-language question is not required to match in full', () => {
    // Regression: these were AND-ed, so a question carrying filler its target chunk
    // lacks ("how to …") matched nothing at all.
    expect(toFtsMatchQuery('hello world')).toBe('"hello" OR "world"')
    expect(toFtsMatchQuery('how to configure proxy timeout')).toBe('"how" OR "configure" OR "proxy" OR "timeout"')
  })

  it('ORs the trigrams of a CJK question', () => {
    // Regression: the whole clause was one quoted token, i.e. an exact-substring
    // demand, so a question phrased around the indexed words never matched.
    expect(toFtsMatchQuery('公司的报销流程')).toBe('"公司的" OR "司的报" OR "的报销" OR "报销流" OR "销流程"')
  })

  it('quotes each term and escapes embedded quotes', () => {
    expect(toFtsMatchQuery('rag2 系统 v_2')).toBe('"rag2" OR "v_2"')
  })

  it('returns null when the text yields no indexable term', () => {
    expect(toFtsMatchQuery('')).toBeNull()
    expect(toFtsMatchQuery('   \n\t')).toBeNull()
    expect(toFtsMatchQuery('!!! --- ???')).toBeNull()
    // Every token is below the trigram minimum — MATCH could only return nothing.
    expect(toFtsMatchQuery('a, b.c-d!')).toBeNull()
  })
})

describe('needsLikeFallback', () => {
  it('is false when at least one term is indexable', () => {
    expect(needsLikeFallback('hello world')).toBe(false)
    expect(needsLikeFallback('rag2 系统统')).toBe(false)
  })

  it('is false for a mixed query, whose short tokens are dropped rather than routed to LIKE', () => {
    // A short token no longer poisons the query, so the ranked MATCH path is kept.
    expect(needsLikeFallback('the 天气 today')).toBe(false)
  })

  it('is true only when tokens exist but none can be indexed', () => {
    expect(needsLikeFallback('天气')).toBe(true)
    expect(needsLikeFallback('ab')).toBe(true)
  })

  it('is false when the text yields no token at all', () => {
    expect(needsLikeFallback('!!! --- ???')).toBe(false)
    expect(needsLikeFallback('')).toBe(false)
  })
})

describe('toFtsLikePattern', () => {
  it('wraps the token in % for a substring match', () => {
    expect(toFtsLikePattern('abc')).toBe('%abc%')
  })

  it('escapes an underscore — the only LIKE wildcard reachable through the token charset', () => {
    // extractFtsTokens admits `_` (via \p{L}\p{N}_), so an unescaped `v_2` would
    // match `vX2` for any X. The escape (paired with ESCAPE '\') keeps it literal.
    expect(toFtsLikePattern('v_2')).toBe('%v\\_2%')
  })

  it('defensively escapes % and the escape char itself even though tokens cannot contain them', () => {
    expect(toFtsLikePattern('a%b')).toBe('%a\\%b%')
    expect(toFtsLikePattern('a\\b')).toBe('%a\\\\b%')
  })
})
