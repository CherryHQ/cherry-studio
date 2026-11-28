import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { TranslateLanguageSeeder } from '@data/db/seeding/seeders/translateLanguageSeeder'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translateLanguages'

describe('TranslateLanguageSeeder', () => {
  const dbh = setupTestDatabase()

  it('should insert all builtin languages into empty table', async () => {
    const seed = new TranslateLanguageSeeder()
    seed.run(dbh.db)

    const rows = await dbh.db.select().from(translateLanguageTable)
    expect(rows).toHaveLength(BUILTIN_TRANSLATE_LANGUAGES.length)
    expect(rows.map((row) => row.langCode).sort()).toEqual(
      BUILTIN_TRANSLATE_LANGUAGES.map((row) => row.langCode).sort()
    )
  })

  it('should only insert missing languages and preserve customized existing rows', async () => {
    // User-customized rows: same builtin keys, edited display values. An unchanged row
    // count alone would not prove these survive seeding.
    const preExisting = BUILTIN_TRANSLATE_LANGUAGES.slice(0, 2).map((row) => ({
      ...row,
      value: `custom-${row.value}`
    }))
    await dbh.db.insert(translateLanguageTable).values(preExisting)

    const seed = new TranslateLanguageSeeder()
    seed.run(dbh.db)

    const rows = await dbh.db.select().from(translateLanguageTable)
    expect(rows).toHaveLength(BUILTIN_TRANSLATE_LANGUAGES.length)
    expect(rows.map((row) => row.langCode).sort()).toEqual(
      BUILTIN_TRANSLATE_LANGUAGES.map((row) => row.langCode).sort()
    )
    for (const customized of preExisting) {
      const row = rows.find((r) => r.langCode === customized.langCode)
      expect(row?.value).toBe(customized.value)
    }
  })
})
