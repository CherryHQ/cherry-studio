import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { TranslateLanguageSeeder } from '@data/db/seeding/seeders/translateLanguageSeeder'
import { BUILTIN_TRANSLATE_LANGUAGES } from '@shared/data/presets/translate-languages'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('TranslateLanguageSeeder', () => {
  const dbh = setupTestDatabase()

  it('should insert all builtin languages into empty table', async () => {
    const seed = new TranslateLanguageSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(translateLanguageTable)
    expect(rows).toHaveLength(BUILTIN_TRANSLATE_LANGUAGES.length)
  })

  it('should only insert missing languages when some exist', async () => {
    const preExisting = [...BUILTIN_TRANSLATE_LANGUAGES.slice(0, 2)]
    await dbh.db.insert(translateLanguageTable).values(preExisting)

    const seed = new TranslateLanguageSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db.select().from(translateLanguageTable)
    expect(rows).toHaveLength(BUILTIN_TRANSLATE_LANGUAGES.length)
  })

  it('should not modify existing rows when all languages exist', async () => {
    await dbh.db.insert(translateLanguageTable).values([...BUILTIN_TRANSLATE_LANGUAGES])
    const beforeCount = (await dbh.db.select().from(translateLanguageTable)).length

    const seed = new TranslateLanguageSeeder()
    await seed.run(dbh.db)

    const afterCount = (await dbh.db.select().from(translateLanguageTable)).length
    expect(afterCount).toBe(beforeCount)
  })
})
