import { describe, expect, it } from 'vitest'

import { needsLikeFallback, toFtsLikePattern, toFtsMatchQuery } from '../ftsQuery'

describe('toFtsMatchQuery', () => {
  it('extracts word/number/underscore tokens and ANDs them, each quoted', () => {
    expect(toFtsMatchQuery('hello world')).toBe('"hello" AND "world"')
    expect(toFtsMatchQuery('rag2 系统 v_2')).toBe('"rag2" AND "系统" AND "v_2"')
  })

  it('splits on punctuation/whitespace and drops the separators', () => {
    expect(toFtsMatchQuery('a, b.c-d!')).toBe('"a" AND "b" AND "c" AND "d"')
  })

  it('returns null when the text yields no usable token', () => {
    expect(toFtsMatchQuery('')).toBeNull()
    expect(toFtsMatchQuery('   \n\t')).toBeNull()
    expect(toFtsMatchQuery('!!! --- ???')).toBeNull()
  })
})

describe('needsLikeFallback', () => {
  it('is false when every token is long enough for the trigram tokenizer', () => {
    expect(needsLikeFallback('hello world')).toBe(false)
    expect(needsLikeFallback('rag2 系统统')).toBe(false) // 系统统 is 3 code points
  })

  it('is true when any token is shorter than 3 code points (1–2 char CJK words)', () => {
    expect(needsLikeFallback('天气')).toBe(true)
    expect(needsLikeFallback('ab')).toBe(true)
  })

  it('routes the whole query to fallback when even one short token is mixed with long ones', () => {
    // One short token poisons an AND of longer tokens, so the decision is per-query.
    expect(needsLikeFallback('the 天气 today')).toBe(true)
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
