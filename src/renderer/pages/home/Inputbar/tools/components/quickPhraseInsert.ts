export interface QuickPhraseInsertTrigger {
  type: 'input' | 'button'
  position?: number
  symbol?: string
  searchText?: string
}

export interface QuickPhraseInsertResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

interface ComputeQuickPhraseInsertOptions {
  currentValue: string
  insertText: string
  rootSymbol: string
  triggerInfo?: QuickPhraseInsertTrigger
  selectionStart?: number | null
  selectionEnd?: number | null
}

export function computeQuickPhraseInsertResult({
  currentValue,
  insertText,
  rootSymbol,
  triggerInfo,
  selectionStart,
  selectionEnd
}: ComputeQuickPhraseInsertOptions): QuickPhraseInsertResult {
  if (triggerInfo?.type === 'input' && triggerInfo.position !== undefined) {
    const start = clampIndex(triggerInfo.position, currentValue.length)
    const symbol = triggerInfo.symbol ?? rootSymbol
    const searchText = triggerInfo.searchText ?? ''
    const end = findQuickPanelTokenEnd(currentValue, start, symbol, searchText)
    return replaceRange(currentValue, insertText, start, end)
  }

  const start = clampIndex(selectionStart ?? currentValue.length, currentValue.length)
  const end = clampIndex(selectionEnd ?? start, currentValue.length)
  return replaceRange(currentValue, insertText, Math.min(start, end), Math.max(start, end))
}

function findQuickPanelTokenEnd(text: string, start: number, symbol: string, searchText: string): number {
  let end = start + 1
  if (searchText) {
    const expected = symbol + searchText
    const actual = text.slice(start, start + expected.length)
    if (actual === expected) {
      return start + expected.length
    }
  }

  while (end < text.length && !/\s/.test(text[end])) {
    end++
  }
  return end
}

function replaceRange(value: string, insertText: string, start: number, end: number): QuickPhraseInsertResult {
  return {
    value: value.slice(0, start) + insertText + value.slice(end),
    selectionStart: start,
    selectionEnd: start + insertText.length
  }
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}
