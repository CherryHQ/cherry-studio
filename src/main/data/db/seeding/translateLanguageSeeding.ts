import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translate-languages'

import type { DbType, ISeed } from '../types'

class TranslateLanguageSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const existing = await db.select({ langCode: translateLanguageTable.langCode }).from(translateLanguageTable)

    const existingCodes = new Set(existing.map((r) => r.langCode))

    const newLanguages = BUILTIN_TRANSLATE_LANGUAGES.filter((l) => !existingCodes.has(l.langCode))

    if (newLanguages.length > 0) {
      await db.insert(translateLanguageTable).values(newLanguages)
    }
  }
}

export default TranslateLanguageSeed
