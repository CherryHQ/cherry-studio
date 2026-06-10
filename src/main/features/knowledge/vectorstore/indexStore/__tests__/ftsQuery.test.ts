import { describe, expect, it } from 'vitest'

import { toFtsMatchQuery } from '../ftsQuery'

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
