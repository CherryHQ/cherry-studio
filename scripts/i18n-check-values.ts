/** Checks source and translated catalog values before changes merge. */
import * as fs from 'fs'
import * as path from 'path'

/** Catalogs are flat: every key is a dotted path mapping straight to its translated string. */
type I18N = { [key: string]: string }
type Glossary = { doNotTranslate: string[] }

const ROOT = path.resolve(__dirname, '..')
const BASE_LOCALE = process.env.TRANSLATION_BASE_LOCALE ?? 'en-us'
const CATALOG_DIRECTORIES = ['src/renderer/i18n/locales', 'src/main/i18n/locales']
const ALLOWED_EMPTY_SOURCE_KEYS = new Set(['src/renderer/i18n/locales:settings.provider.oauth.provided_by_suffix'])

const interpolations = (text: string) => (text.match(/{{[^}]*}}/g) ?? []).sort()
const tagPlaceholders = (text: string) => (text.match(/<\/?[\w-]+\s*\/?>/g) ?? []).sort()
const nestedKeys = (text: string) => (text.match(/\$t\([^)]*\)/g) ?? []).sort()

/** Case and separators vary legitimately: "Github", "Cherry-Studio-Diagnose". Spelling does not. */
const foldForTermMatch = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export const validateSource = (source: string): string | null => {
  const text = source.trim()

  if (!text) return 'empty source value'
  if (/to be translated/i.test(text)) return 'placeholder marker leaked into the source locale'

  return null
}

export const validate = (english: string, translation: string, doNotTranslate: string[] = []): string | null => {
  const text = translation.trim()

  if (!text) return /[\p{L}\p{N}]/u.test(english) ? 'empty' : null
  if (/to be translated/i.test(text)) return 'placeholder marker leaked into the translation'
  if (text.startsWith('[') && !english.trim().startsWith('[')) {
    return 'starts with a bracketed note instead of the translation'
  }
  if (text.length > Math.max(80, english.length * 4)) {
    return 'suspiciously long - likely an explanation, not a translation'
  }

  const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
  if (!sameList(interpolations(english), interpolations(translation))) {
    return `interpolation mismatch: expected ${interpolations(english).join(' ') || '(none)'}`
  }
  if (!sameList(tagPlaceholders(english), tagPlaceholders(translation))) {
    return `tag placeholder mismatch: expected ${tagPlaceholders(english).join(' ') || '(none)'}`
  }
  if (!sameList(nestedKeys(english), nestedKeys(translation))) {
    return `$t() reference mismatch: expected ${nestedKeys(english).join(' ') || '(none)'}`
  }

  const foldedEnglish = foldForTermMatch(english)
  const foldedTranslation = foldForTermMatch(text)
  for (const term of doNotTranslate) {
    const foldedTerm = foldForTermMatch(term)
    if (foldedEnglish.includes(foldedTerm) && !foldedTranslation.includes(foldedTerm)) {
      return `dropped untranslatable term "${term}"`
    }
  }

  return null
}

const readJson = (filePath: string): I18N => JSON.parse(fs.readFileSync(filePath, 'utf-8'))

export const checkTranslationValues = (): { checked: number; failures: string[] } => {
  const glossary = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-glossary.json'), 'utf-8')) as Glossary
  const failures: string[] = []
  let checked = 0

  for (const catalogDirectory of CATALOG_DIRECTORIES) {
    const catalogPath = path.join(ROOT, catalogDirectory)
    const basePath = path.join(catalogPath, `${BASE_LOCALE}.json`)
    const base = readJson(basePath)

    for (const [key, source] of Object.entries(base)) {
      checked++
      const allowedEmpty = !source.trim() && ALLOWED_EMPTY_SOURCE_KEYS.has(`${catalogDirectory}:${key}`)
      const reason = allowedEmpty ? null : validateSource(source)
      if (reason) failures.push(`${catalogDirectory}/${BASE_LOCALE}.json ${key}: ${reason}`)
    }

    for (const filename of fs.readdirSync(catalogPath).filter((file) => file.endsWith('.json'))) {
      if (filename === `${BASE_LOCALE}.json`) continue

      const target = readJson(path.join(catalogPath, filename))
      for (const [key, translation] of Object.entries(target)) {
        const english = base[key]
        if (english === undefined) continue

        checked++
        const reason = validate(english, translation, glossary.doNotTranslate)
        if (reason) failures.push(`${catalogDirectory}/${filename} ${key}: ${reason}`)
      }
    }
  }

  return { checked, failures }
}
