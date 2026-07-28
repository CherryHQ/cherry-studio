import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translateLanguages'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class TranslateLanguageSeeder implements ISeeder {
  readonly name = 'translateLanguage'
  readonly description = 'Insert builtin translation languages'
  readonly version: string

  constructor() {
    this.version = hashObject(BUILTIN_TRANSLATE_LANGUAGES)
  }

  run(db: DbType): void {
    const existing = db.select({ langCode: translateLanguageTable.langCode }).from(translateLanguageTable).all()

    const existingCodes = new Set(existing.map((r) => r.langCode))

    const newLanguages = BUILTIN_TRANSLATE_LANGUAGES.filter((l) => !existingCodes.has(l.langCode))

    if (newLanguages.length > 0) {
      db.insert(translateLanguageTable).values(newLanguages).run()
    }
  }
}
