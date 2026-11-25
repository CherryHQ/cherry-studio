const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = {
  el: /\p{Script=Greek}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ru: /\p{Script=Cyrillic}/u,
  th: /\p{Script=Thai}/u,
  zh: /\p{Script=Han}/u
}

/**
 * Whether `text` already reads in the UI `language`, judged by writing system. Latin-script
 * languages other than English cannot be told apart this way, so they always count as not.
 */
export function isLikelyInLanguage(text: string, language: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return true
  const base = language.toLowerCase().split(/[-_]/)[0]
  const share = (pattern: RegExp) => letters.filter((letter) => pattern.test(letter)).length / letters.length
  if (base === 'en') return share(/\p{Script=Latin}/u) >= 0.9
  // Kana separates Japanese from Chinese; both are mostly Han.
  if (base === 'zh' && KANA.test(text)) return false
  if (base === 'ja' && !KANA.test(text)) return false
  const script = SCRIPT_BY_LANGUAGE[base]
  return script ? share(script) >= 0.5 : false
}
