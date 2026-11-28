const LANGUAGE_SCRIPTS: Record<string, RegExp> = {
  el: /\p{Script=Greek}/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  th: /\p{Script=Thai}/u,
  zh: /\p{Script=Han}/u
}
// A letter outside the Latin script; digits, punctuation and symbols never match.
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}]/u

/**
 * Whether raw text (an error message, a CLI diagnostic) can sit next to copy in `language`.
 * Script check only: Latin-script languages other than English cannot be told apart from English.
 */
export function readsInLanguage(text: string, language: string | undefined): boolean {
  const code = (language ?? '').split('-')[0].toLowerCase()
  const script = LANGUAGE_SCRIPTS[code]
  if (script) return script.test(text)
  return (code === 'en' || code === '') && !NON_LATIN_LETTER.test(text)
}
