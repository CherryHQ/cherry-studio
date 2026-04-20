import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translate-languages'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class TranslateLanguageSeeder implements ISeeder {
  readonly name = 'translateLanguage'
  readonly description = 'Insert builtin translation languages'
  readonly version: string

  constructor() {
    this.version = hashObject(BUILTIN_TRANSLATE_LANGUAGES)
  }

  async run(db: DbType): Promise<void> {
    const existing = await db.select({ langCode: translateLanguageTable.langCode }).from(translateLanguageTable)

    const existingCodes = new Set(existing.map((r) => r.langCode))

    const newLanguages = BUILTIN_TRANSLATE_LANGUAGES.filter((l) => !existingCodes.has(l.langCode))

    if (newLanguages.length > 0) {
      await db.insert(translateLanguageTable).values(newLanguages)
    }
  }
}
