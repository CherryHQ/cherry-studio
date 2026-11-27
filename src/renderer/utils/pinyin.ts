import * as tinyPinyin from 'tiny-pinyin'

const MAX_PINYIN_CACHE_SIZE = 512
const cache = new Map<string, { full: string; initials: string; searchInitials: string }>()

const hasChinese = (text: string) => /[\u4e00-\u9fff]/.test(text)

/**
 * Converts Chinese text to lowercase full pinyin and first-letter initials
 * (代理 → { full: 'daili', initials: 'dl' }). Non-Chinese segments pass
 * through in `full` so mixed text still matches its latin part; `initials`
 * only keeps the first letter of Chinese syllables (latin segments are
 * dropped to keep acronym matching unambiguous).
 */
function getPinyinForms(text: string) {
  if (!hasChinese(text) || !tinyPinyin.isSupported()) return { full: '', initials: '', searchInitials: '' }

  const cached = cache.get(text)
  if (cached) return cached

  const tokens = tinyPinyin.parse(text)
  let full = ''
  let initials = ''
  let searchInitials = ''
  for (const token of tokens) {
    if (token.type === 2) {
      const syllable = token.target.toLowerCase()
      full += syllable
      initials += syllable[0]
      searchInitials += syllable[0]
    } else {
      full += token.target.toLowerCase()
      searchInitials += token.target.toLowerCase()
    }
  }

  const forms = { full, initials, searchInitials }
  if (cache.size >= MAX_PINYIN_CACHE_SIZE) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(text, forms)
  return forms
}

export function toPinyinForms(text: string): { full: string; initials: string } {
  const { full, initials } = getPinyinForms(text)
  return { full, initials }
}

/** Matches contiguous initials, preserving Latin text, whitespace and punctuation boundaries. */
export function matchesPinyinInitials(text: string, query: string): boolean {
  if (!query || !/[a-z]/i.test(query)) return false
  const { searchInitials } = getPinyinForms(text)
  return searchInitials.includes(query.toLowerCase())
}

/** Case-insensitive substring search with an additive Chinese-initials fallback. */
export function matchesSearchText(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase()) || matchesPinyinInitials(text, query)
}
