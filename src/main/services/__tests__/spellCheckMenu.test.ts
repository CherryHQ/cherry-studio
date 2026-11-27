import { describe, expect, it } from 'vitest'

import { buildSpellCheckMenuItems, resolveLearnedSelection } from '../spellCheckMenu'

describe('resolveLearnedSelection', () => {
  it('returns the trimmed word when it is in the custom dictionary', () => {
    expect(resolveLearnedSelection('  CherryAI  ', ['CherryAI', 'other'])).toBe('CherryAI')
  })

  it('returns null for words that were never learned', () => {
    expect(resolveLearnedSelection('missspelled', ['CherryAI'])).toBeNull()
  })

  it('returns null for multi-word selections so Unlearn cannot target a phrase', () => {
    expect(resolveLearnedSelection('CherryAI Studio', ['CherryAI', 'Studio'])).toBeNull()
  })
})

describe('buildSpellCheckMenuItems', () => {
  it('offers suggestions plus Learn Spelling for a misspelled editable selection', () => {
    expect(
      buildSpellCheckMenuItems({
        isEditable: true,
        selectionText: 'missspelled',
        misspelledWord: 'missspelled',
        dictionarySuggestions: ['misspelled', 'disspelled'],
        customWords: []
      })
    ).toEqual([
      { id: 'dictionarySuggestion', label: 'misspelled', enabled: true, suggestion: 'misspelled' },
      { id: 'dictionarySuggestion', label: 'disspelled', enabled: true, suggestion: 'disspelled' },
      { id: 'learnSpelling', word: 'missspelled' }
    ])
  })

  it('shows No Guesses plus Learn Spelling when Chromium has no suggestions', () => {
    expect(
      buildSpellCheckMenuItems({
        isEditable: true,
        selectionText: 'xyzzyword',
        misspelledWord: 'xyzzyword',
        dictionarySuggestions: [],
        customWords: []
      })
    ).toEqual([
      { id: 'noGuesses', enabled: false },
      { id: 'learnSpelling', word: 'xyzzyword' }
    ])
  })

  it('offers Unlearn Spelling when a learned custom word is selected and no longer misspelled', () => {
    // Catches the #20570 bug: after Learn Spelling there was no in-app reverse action.
    expect(
      buildSpellCheckMenuItems({
        isEditable: true,
        selectionText: 'CherryAI',
        misspelledWord: '',
        dictionarySuggestions: [],
        customWords: ['CherryAI', 'other']
      })
    ).toEqual([{ id: 'unlearnSpelling', word: 'CherryAI' }])
  })

  it('does not offer Unlearn for a correctly spelled word outside the custom dictionary', () => {
    expect(
      buildSpellCheckMenuItems({
        isEditable: true,
        selectionText: 'hello',
        misspelledWord: '',
        dictionarySuggestions: [],
        customWords: ['CherryAI']
      })
    ).toEqual([])
  })

  it('hides all spell-check actions for non-editable targets', () => {
    expect(
      buildSpellCheckMenuItems({
        isEditable: false,
        selectionText: 'CherryAI',
        misspelledWord: '',
        dictionarySuggestions: [],
        customWords: ['CherryAI']
      })
    ).toEqual([])
  })

  it('hides all spell-check actions when nothing is selected', () => {
    expect(
      buildSpellCheckMenuItems({
        isEditable: true,
        selectionText: '   ',
        misspelledWord: '',
        dictionarySuggestions: [],
        customWords: ['CherryAI']
      })
    ).toEqual([])
  })
})
