import { describe, expect, it } from 'vitest'

import { computeQuickPhraseInsertResult } from '../quickPhraseInsert'

describe('computeQuickPhraseInsertResult', () => {
  it('replaces the quick-panel trigger token and selects inserted text', () => {
    expect(
      computeQuickPhraseInsertResult({
        currentValue: 'Please /trip today',
        insertText: 'plan ${from}',
        rootSymbol: '/',
        triggerInfo: { type: 'input', position: 7, symbol: '/', searchText: 'trip' }
      })
    ).toEqual({
      value: 'Please plan ${from} today',
      selectionStart: 7,
      selectionEnd: 19
    })
  })

  it('falls back to token scanning when search text no longer matches', () => {
    expect(
      computeQuickPhraseInsertResult({
        currentValue: 'Please /stale today',
        insertText: 'fresh',
        rootSymbol: '/',
        triggerInfo: { type: 'input', position: 7, symbol: '/', searchText: 'trip' }
      }).value
    ).toBe('Please fresh today')
  })

  it('replaces the current textarea selection', () => {
    expect(
      computeQuickPhraseInsertResult({
        currentValue: 'Hello old world',
        insertText: 'new',
        rootSymbol: '/',
        selectionStart: 6,
        selectionEnd: 9
      })
    ).toEqual({
      value: 'Hello new world',
      selectionStart: 6,
      selectionEnd: 9
    })
  })

  it('appends when no textarea selection is available', () => {
    expect(
      computeQuickPhraseInsertResult({
        currentValue: 'Hello ',
        insertText: 'world',
        rootSymbol: '/'
      })
    ).toEqual({
      value: 'Hello world',
      selectionStart: 6,
      selectionEnd: 11
    })
  })
})
