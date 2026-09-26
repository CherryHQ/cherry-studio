import * as tinyPinyin from 'tiny-pinyin'

const cache = new Map<string, { full: string; initials: string }>()

const hasChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text)

/**
 * Converts Chinese text to lowercase full pinyin and first-letter initials
 * (代理 → { full: 'daili', initials: 'dl' }). Non-Chinese segments pass
 * through in `full` so mixed text still matches its latin part; `initials`
 * only keeps the first letter of Chinese syllables (latin segments are
 * dropped to keep acronym matching unambiguous).
 */
export function toPinyinForms(text: string): { full: string; initials: string } {
  if (!hasChinese(text) || !tinyPinyin.isSupported()) return { full: '', initials: '' }

  const cached = cache.get(text)
  if (cached) return cached

  const tokens = tinyPinyin.parse(text)
  let full = ''
  let initials = ''
  for (const token of tokens) {
    if (token.type === 2) {
      const syllable = token.target.toLowerCase()
      full += syllable
      initials += syllable[0]
    } else {
      full += token.target.toLowerCase()
    }
  }

  const forms = { full, initials }
  cache.set(text, forms)
  return forms
}
