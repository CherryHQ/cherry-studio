import { cacheService } from '@data/CacheService'

const TRANSLATION_TTL_MS = 60 * 60 * 1000
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

/**
 * `text` in the UI `language`: unchanged when it already reads that way, else a cached AI
 * translation. Resolves '' when no translation is available, and that miss is not cached.
 */
export function translateErrorMessage(text: string, language: string): Promise<string> {
  if (!text || isLikelyInLanguage(text, language)) return Promise.resolve(text)
  const cacheKey = `error.translate.${language}:${text}`
  const cached = cacheService.getCasual<Promise<string>>(cacheKey)
  if (cached) return cached
  const promise = import('@renderer/utils/errorDiagnosis')
    .then(({ translateErrorByAI }) => translateErrorByAI(text, language))
    .catch(() => '')
    .then((translated) => {
      if (!translated) cacheService.deleteCasual(cacheKey)
      return translated
    })
  cacheService.setCasual<Promise<string>>(cacheKey, promise, TRANSLATION_TTL_MS)
  return promise
}
