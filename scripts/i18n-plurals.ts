/**
 * Plural-form rules shared by the i18n check, sync and value scripts.
 *
 * English catalogs only carry `_one` / `_other`, but i18next picks the plural suffix
 * from `Intl.PluralRules` of the active language. Polish, for example, resolves
 * 2 to `_few` and 5 to `_many`; when those keys are missing i18next falls back to
 * the English catalog instead of the same-locale `_other` form.
 */
import * as path from 'path'

/** Catalogs are flat: every key is a dotted path mapping straight to its translated string. */
type I18N = { [key: string]: string }

const PLURAL_SUFFIX_RE = /^(.+)_(zero|one|two|few|many|other)$/

/**
 * Locales whose catalogs must carry every plural form their language selects.
 * Other locales may add their extra forms but are not yet required to.
 */
export const COMPLETE_PLURAL_LOCALES = new Set(['pl-pl'])

/** `pl-pl.json` -> `pl-PL`. */
export const localeFromFileName = (fileName: string): string => {
  const [language, region] = path.basename(fileName, '.json').split('-')
  return region ? `${language}-${region.toUpperCase()}` : language
}

export const pluralCategories = (fileName: string): string[] =>
  new Intl.PluralRules(localeFromFileName(fileName)).resolvedOptions().pluralCategories

/** Stems that the base catalog pluralizes, i.e. both `<stem>_one` and `<stem>_other` exist. */
export const pluralStems = (base: I18N): Set<string> => {
  const stems = new Set<string>()
  for (const key of Object.keys(base)) {
    const match = PLURAL_SUFFIX_RE.exec(key)
    if (match?.[2] === 'other' && `${match[1]}_one` in base) stems.add(match[1])
  }
  return stems
}

export interface LocaleKeySpec {
  /** Keys the target catalog must contain. */
  required: Set<string>
  /** Keys the target catalog may contain (superset of `required`). */
  allowed: Set<string>
  /** Base-catalog key whose English text a target key is translated from. */
  sourceKey: Map<string, string>
}

/** Expected key set of a target catalog: the base keys plus the locale's own plural forms. */
export const localeKeySpec = (base: I18N, fileName: string): LocaleKeySpec => {
  const required = new Set(Object.keys(base))
  const allowed = new Set(required)
  const sourceKey = new Map([...required].map((key) => [key, key]))
  const complete = COMPLETE_PLURAL_LOCALES.has(path.basename(fileName, '.json'))
  const categories = pluralCategories(fileName)

  for (const stem of pluralStems(base)) {
    for (const category of categories) {
      const key = `${stem}_${category}`
      if (sourceKey.has(key)) continue
      allowed.add(key)
      sourceKey.set(key, `${stem}_other`)
      if (complete) required.add(key)
    }
  }

  return { required, allowed, sourceKey }
}

/** Plural siblings that only exist in target catalogs and must be removed with `<stem>_other`. */
export const localeOnlyPluralSiblings = (key: string): string[] => {
  const match = PLURAL_SUFFIX_RE.exec(key)
  if (match?.[2] !== 'other') return []
  return ['zero', 'two', 'few', 'many'].map((category) => `${match[1]}_${category}`)
}
