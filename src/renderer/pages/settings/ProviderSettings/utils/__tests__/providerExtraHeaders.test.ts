import { describe, expect, it } from 'vitest'

import { buildExtraHeadersReplacementPatch } from '../providerExtraHeaders'

describe('buildExtraHeadersReplacementPatch', () => {
  it('marks headers removed since the previous snapshot with null', () => {
    expect(buildExtraHeadersReplacementPatch({ 'X-Keep': 'a', 'X-Remove': 'b' }, { 'X-Keep': 'a' })).toEqual({
      'X-Keep': 'a',
      'X-Remove': null
    })
  })

  it('marks every previous header with null when clearing all', () => {
    expect(buildExtraHeadersReplacementPatch({ 'X-Only': 'a' }, {})).toEqual({ 'X-Only': null })
  })

  it('marks Object.prototype-named headers with null instead of treating them as present', () => {
    expect(buildExtraHeadersReplacementPatch({ toString: 'a', constructor: 'b' }, {})).toEqual({
      toString: null,
      constructor: null
    })
  })

  it('marks a renamed header by nulling the old key', () => {
    expect(buildExtraHeadersReplacementPatch({ 'X-Old': 'a' }, { 'X-New': 'a' })).toEqual({
      'X-New': 'a',
      'X-Old': null
    })
  })

  it('passes new headers through when nothing existed before', () => {
    expect(buildExtraHeadersReplacementPatch({}, { 'X-First': 'a' })).toEqual({ 'X-First': 'a' })
  })

  it('returns an empty patch when both snapshots are empty', () => {
    expect(buildExtraHeadersReplacementPatch({}, {})).toEqual({})
  })
})
