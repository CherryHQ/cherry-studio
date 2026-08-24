import * as tinyPinyin from 'tiny-pinyin'

import type { SettingsNavigationSection } from './settingsNavigation'

type SettingsCatalog = Record<string, string>
type Translate = (key: string) => string

export interface SettingsSearchEntry {
  path: string
  haystacks: readonly SettingsSearchHaystack[]
}

interface SettingsSearchHaystack {
  searchText: string
  whitespaceFreeText: string
  pinyinText: string
}

function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}.`)
}

function buildPinyinText(text: string): string {
  if (!tinyPinyin.isSupported() || !/[\u4e00-\u9fa5]/.test(text)) return ''

  const words = tinyPinyin.convertToPinyin(text, ' ', true).toLowerCase().split(/\s+/).filter(Boolean)
  return `${words.join('')} ${words.map((word) => word[0] ?? '').join('')}`
}

export function buildSettingsSearchEntries(
  sections: readonly SettingsNavigationSection[],
  englishCatalog: SettingsCatalog,
  translate: Translate
): SettingsSearchEntry[] {
  const items = sections.flatMap((section) => section.items)
  const keysByPath = new Map(
    items.map((item) => [item.path, new Set([item.labelKey, ...(item.search.exactKeys ?? [])])])
  )

  for (const key of Object.keys(englishCatalog)) {
    let longestPrefixLength = -1
    let owners: typeof items = []

    for (const item of items) {
      const prefixLength = Math.max(
        -1,
        ...item.search.prefixes.filter((prefix) => matchesPrefix(key, prefix)).map((prefix) => prefix.length)
      )
      if (prefixLength < longestPrefixLength) continue

      if (prefixLength > longestPrefixLength) {
        longestPrefixLength = prefixLength
        owners = []
      }
      if (prefixLength >= 0) owners.push(item)
    }

    for (const owner of owners) keysByPath.get(owner.path)?.add(key)
  }

  return items.map((item) => {
    return {
      path: item.path,
      haystacks: Array.from(keysByPath.get(item.path) ?? [], (key) => {
        const texts = new Set([translate(key).trim(), englishCatalog[key]?.trim()].filter(Boolean))
        const searchText = Array.from(texts).join(' ').toLowerCase()
        return {
          searchText,
          whitespaceFreeText: searchText.replace(/\s+/g, ''),
          pinyinText: buildPinyinText(searchText)
        }
      })
    }
  })
}

export function filterSettingsSearchEntries(
  entries: readonly SettingsSearchEntry[],
  query: string
): SettingsSearchEntry[] {
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return [...entries]

  return entries.filter((entry) =>
    entry.haystacks.some((haystack) =>
      keywords.every(
        (keyword) =>
          haystack.searchText.includes(keyword) ||
          haystack.whitespaceFreeText.includes(keyword) ||
          haystack.pinyinText.includes(keyword)
      )
    )
  )
}
