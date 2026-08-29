import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PASTE_AS_FILE_KEY = 'chat.input.paste_long_text_as_file'
const PASTE_THRESHOLD_KEY = 'chat.input.paste_long_text_threshold'
const PASTE_PREFERENCE_SEEDERS = seeders.filter(
  ({ name }) => name === 'cherryaiDefaultModel' || name === 'longTextPastePreferenceUpgrade' || name === 'preference'
)

describe('LongTextPastePreferenceUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = async (key: string) => {
    const [row] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
    return row?.value
  }

  const addExistingPreference = async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'app.language',
      value: 'en-us'
    })
  }

  it('keeps the generated inline-paste default for a new installation', async () => {
    new SeedRunner(dbh.db).runAll(PASTE_PREFERENCE_SEEDERS)

    expect(await readPreference(PASTE_AS_FILE_KEY)).toBe(false)
    expect(await readPreference(PASTE_THRESHOLD_KEY)).toBe(1500)
  })

  it('preserves the current main behavior for an existing v2 installation', async () => {
    await addExistingPreference()

    new SeedRunner(dbh.db).runAll(PASTE_PREFERENCE_SEEDERS)

    expect(await readPreference(PASTE_AS_FILE_KEY)).toBe(true)
    expect(await readPreference(PASTE_THRESHOLD_KEY)).toBe(1500)
  })

  it('does not overwrite long-text paste preferences that already exist', async () => {
    await addExistingPreference()
    await dbh.db.insert(preferenceTable).values([
      { scope: 'default', key: PASTE_AS_FILE_KEY, value: false },
      { scope: 'default', key: PASTE_THRESHOLD_KEY, value: 3200 }
    ])

    new SeedRunner(dbh.db).runAll(PASTE_PREFERENCE_SEEDERS)

    expect(await readPreference(PASTE_AS_FILE_KEY)).toBe(false)
    expect(await readPreference(PASTE_THRESHOLD_KEY)).toBe(3200)
  })
})
