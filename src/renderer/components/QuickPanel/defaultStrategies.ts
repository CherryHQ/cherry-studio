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

function isSlashCommandToken(text: string): boolean {
  return /^\/[^\s/]+$/.test(text)
}

function getSlashCommandName(text: string): string | undefined {
  return isSlashCommandToken(text) ? text.slice(1) : undefined
}

function findEarliestSubstringIndex(candidates: readonly string[], query: string): number {
  let earliest = -1
  for (const candidate of candidates) {
    const index = candidate.indexOf(query)
    if (index !== -1 && (earliest === -1 || index < earliest)) {
      earliest = index
    }
  }
  return earliest
}

/**
 * Calculate match score for sorting.
 * Higher score = better match, prioritizing name/command matches over aliases and descriptions.
 */
export const calculateMatchScore = (item: QuickPanelListItem, searchText: string): number => {
  const lowerSearchText = searchText.toLowerCase()
  if (!lowerSearchText) return 0

  const lowerLabel = typeof item.label === 'string' ? item.label.toLowerCase() : ''
  const isBareQuery = !lowerSearchText.startsWith('/')
  const commandName = isBareQuery ? getSlashCommandName(lowerLabel) : undefined

  // Tier 1: Exact name match
  if (lowerLabel === lowerSearchText) {
    return 1000
  }
  if (commandName === lowerSearchText) {
    return 950
  }

  const lowerAliases = (item.searchAliases ?? []).map((alias) => alias.toLowerCase())
  if (isBareQuery && lowerAliases.some((alias) => getSlashCommandName(alias) === lowerSearchText)) {
    return 930
  }

  const lowerFilterText = item.filterText ? item.filterText.toLowerCase() : ''
  if (!lowerLabel && lowerFilterText === lowerSearchText) {
    return 920
  }

  // Tier 2: Prefix name match
  if (lowerLabel.startsWith(lowerSearchText) || commandName?.startsWith(lowerSearchText)) {
    return 850
  }
  if (!lowerLabel && lowerFilterText.startsWith(lowerSearchText)) {
    return 770
  }

  // Tier 3: Exact / prefix alias match
  if (lowerAliases.some((alias) => alias === lowerSearchText)) {
    return 740
  }
  if (
    lowerAliases.some(
      (alias) =>
        alias.startsWith(lowerSearchText) ||
        (isBareQuery && Boolean(getSlashCommandName(alias)?.startsWith(lowerSearchText)))
    )
  ) {
    return 700
  }

  // Tier 4: Substring match in name (label)
  if (lowerLabel) {
    const labelPosition = lowerLabel.indexOf(lowerSearchText)
    if (labelPosition !== -1) {
      return Math.max(500, 649 - labelPosition)
    }
  }

  // Tier 5: Substring match in aliases
  const aliasPosition = findEarliestSubstringIndex(lowerAliases, lowerSearchText)
  if (aliasPosition !== -1) {
    return Math.max(350, 499 - aliasPosition)
  }

  // Tier 6: Substring match in description
  const lowerDescription = typeof item.description === 'string' ? item.description.toLowerCase() : ''
  if (lowerDescription) {
    const descPosition = lowerDescription.indexOf(lowerSearchText)
    if (descPosition !== -1) {
      return Math.max(250, 349 - descPosition)
    }
  }

  // Tier 7: Substring match in remaining filterText
  if (lowerFilterText) {
    const filterPosition = lowerFilterText.indexOf(lowerSearchText)
    if (filterPosition !== -1) {
      return Math.max(150, 249 - filterPosition)
    }
  }

  // Tier 8: Pinyin / fuzzy match
  return 100
}

/**
 * Default sort function
 * Sorts items by match score in descending order
 */
export const defaultSortFn: QuickPanelSortFn = (items, searchText) => {
  if (!searchText) return items

  return items
    .map((item) => ({ item, score: calculateMatchScore(item, searchText) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
}
