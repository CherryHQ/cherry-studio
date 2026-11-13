import * as tinyPinyin from 'tiny-pinyin'

import type { QuickPanelFilterFn, QuickPanelListItem, QuickPanelSortFn } from './types'

/**
 * Concatenates all textual search fields into a single haystack for substring /
 * pinyin matching. `filterText` is additive here so the shared QuickPanel
 * strategy keeps matching the visible label and description by default.
 */
function buildItemHaystack(item: QuickPanelListItem): string {
  const parts: string[] = []
  if (item.filterText) parts.push(item.filterText)
  if (typeof item.label === 'string') parts.push(item.label)
  if (typeof item.description === 'string') parts.push(item.description)
  if (item.searchAliases) parts.push(...item.searchAliases)
  return parts.join(' ')
}

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/

function matchesFuzzyQuery(text: string, query: string): boolean {
  if (query.length > text.length) return false

  // Single-character patterns preserve /i's UTF-16 case folding without permitting backtracking.
  const characters = query.split('').map((char) => new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

  if (!LINE_TERMINATOR.test(query)) {
    let matched = 0
    for (let index = 0; index < text.length; index++) {
      const char = text[index]
      if (characters[matched].test(char)) {
        if (++matched === characters.length) return true
      } else if (LINE_TERMINATOR.test(char)) {
        matched = 0
      }
    }
    return false
  }

  // Literal newlines can consume line boundaries; retain overlapping prefixes without recursive retries.
  const prefixes = new Uint8Array(characters.length + 1)
  prefixes[0] = 1
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const canSkip = !LINE_TERMINATOR.test(char)
    for (let length = characters.length - 1; length >= 0; length--) {
      prefixes[length + 1] = Number(
        (prefixes[length] && characters[length].test(char)) || (canSkip && prefixes[length + 1])
      )
    }
    if (prefixes[characters.length]) return true
  }
  return false
}

/**
 * Default filter function
 * Implements standard filtering logic with pinyin support
 */
export const defaultFilterFn: QuickPanelFilterFn = (item, searchText, _fuzzyRegex, pinyinCache) => {
  if (!searchText) return true

  const filterText = buildItemHaystack(item)
  const lowerFilterText = filterText.toLowerCase()
  const lowerSearchText = searchText.toLowerCase()

  // Direct substring match
  if (lowerFilterText.includes(lowerSearchText)) {
    return true
  }

  // Pinyin fuzzy match for Chinese characters
  if (tinyPinyin.isSupported() && /[\u4e00-\u9fa5]/.test(filterText)) {
    try {
      let pinyinText = pinyinCache.get(item)
      if (!pinyinText) {
        pinyinText = tinyPinyin.convertToPinyin(filterText, '', true).toLowerCase()
        pinyinCache.set(item, pinyinText)
      }
      return matchesFuzzyQuery(pinyinText, lowerSearchText)
    } catch (error) {
      return true
    }
  } else {
    return matchesFuzzyQuery(lowerFilterText, lowerSearchText)
  }
}

/**
 * Calculate match score for sorting
 * Higher score = better match
 */
const calculateMatchScore = (item: QuickPanelListItem, searchText: string): number => {
  const filterText = buildItemHaystack(item)
  const lowerFilterText = filterText.toLowerCase()
  const lowerSearchText = searchText.toLowerCase()

  // Exact match (highest priority)
  if (lowerFilterText === lowerSearchText) {
    return 1000
  }

  // Label exact match (very high priority)
  if (typeof item.label === 'string' && item.label.toLowerCase() === lowerSearchText) {
    return 900
  }

  // Starts with search text (high priority)
  if (lowerFilterText.startsWith(lowerSearchText)) {
    return 800
  }

  // Label starts with search text
  if (typeof item.label === 'string' && item.label.toLowerCase().startsWith(lowerSearchText)) {
    return 700
  }

  // Contains search text (medium priority)
  if (lowerFilterText.includes(lowerSearchText)) {
    // Earlier position = higher score
    const position = lowerFilterText.indexOf(lowerSearchText)
    return 600 - position
  }

  // Pinyin fuzzy match (lower priority)
  return 100
}

/**
 * Default sort function
 * Sorts items by match score in descending order
 */
export const defaultSortFn: QuickPanelSortFn = (items, searchText) => {
  if (!searchText) return items

  return [...items].sort((a, b) => {
    const scoreA = calculateMatchScore(a, searchText)
    const scoreB = calculateMatchScore(b, searchText)
    return scoreB - scoreA
  })
}
