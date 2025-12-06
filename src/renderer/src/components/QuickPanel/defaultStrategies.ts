import * as tinyPinyin from 'tiny-pinyin'

import type { QuickPanelFilterFn, QuickPanelListItem, QuickPanelSortFn } from './types'

/**
 * Default filter function
 * Implements standard filtering logic with pinyin support
 */
export const defaultFilterFn: QuickPanelFilterFn = (item, searchText, fuzzyRegex, pinyinCache) => {
  if (!searchText) return true

  let filterText = item.filterText || ''
  if (typeof item.label === 'string') {
    filterText += item.label
  }
  if (typeof item.description === 'string') {
    filterText += item.description
  }

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
      return fuzzyRegex.test(pinyinText)
    } catch (error) {
      return true
    }
  } else {
    return fuzzyRegex.test(filterText.toLowerCase())
  }
}

/**
 * Calculate match score for sorting
 * Higher score = better match
 */
const calculateMatchScore = (item: QuickPanelListItem, searchText: string): number => {
  let filterText = item.filterText || ''
  if (typeof item.label === 'string') {
    filterText += item.label
  }
  if (typeof item.description === 'string') {
    filterText += item.description
  }

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
