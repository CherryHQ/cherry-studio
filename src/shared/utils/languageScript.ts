const LANGUAGE_SCRIPTS: Record<string, RegExp> = {
  el: /\p{Script=Greek}/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ru: /\p{Script=Cyrillic}/u,
  th: /\p{Script=Thai}/u,
  zh: /\p{Script=Han}/u
}
const NON_LATIN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Thai}\p{Script=Arabic}]/u

/**
 * Whether raw text (an error message, a CLI diagnostic) can sit next to copy in `language`.
 * Script check only: Latin-script languages other than English cannot be told apart from English.
 */
export function readsInLanguage(text: string, language: string | undefined): boolean {
  const code = (language ?? '').split('-')[0].toLowerCase()
  const script = LANGUAGE_SCRIPTS[code]
  if (script) return script.test(text)
  return (code === 'en' || code === '') && !NON_LATIN_SCRIPT.test(text)
}
