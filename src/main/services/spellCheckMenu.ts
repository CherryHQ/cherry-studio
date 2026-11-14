export type SpellCheckMenuInput = {
  isEditable: boolean
  selectionText: string
  misspelledWord: string
  dictionarySuggestions: readonly string[]
  customWords: readonly string[]
}

export type SpellCheckMenuItem =
  | { id: 'dictionarySuggestion'; label: string; enabled: true; suggestion: string }
  | { id: 'noGuesses'; enabled: false }
  | { id: 'learnSpelling'; word: string }
  | { id: 'unlearnSpelling'; word: string }

/**
 * Exact single-token selection that already lives in the session custom dictionary.
 * Multi-word selections are ignored so Unlearn never targets an ambiguous phrase.
 */
export function resolveLearnedSelection(selectionText: string, customWords: readonly string[]): string | null {
  const word = selectionText.trim()
  if (!word || /\s/u.test(word)) {
    return null
  }
  return customWords.includes(word) ? word : null
}

/**
 * Decides which spell-check context-menu rows to show.
 * Learned words are no longer misspelled, so Unlearn keys off custom-dictionary membership.
 */
export function buildSpellCheckMenuItems(input: SpellCheckMenuInput): SpellCheckMenuItem[] {
  if (!input.isEditable) {
    return []
  }

  const hasText = input.selectionText.trim().length > 0
  if (!hasText) {
    return []
  }

  if (input.misspelledWord) {
    const items: SpellCheckMenuItem[] =
      input.dictionarySuggestions.length === 0
        ? [{ id: 'noGuesses', enabled: false }]
        : input.dictionarySuggestions.map((suggestion) => ({
            id: 'dictionarySuggestion',
            label: suggestion,
            enabled: true as const,
            suggestion
          }))

    items.push({ id: 'learnSpelling', word: input.misspelledWord })
    return items
  }

  const learnedWord = resolveLearnedSelection(input.selectionText, input.customWords)
  if (learnedWord) {
    return [{ id: 'unlearnSpelling', word: learnedWord }]
  }

  return []
}
