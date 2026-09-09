import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const LEGACY_PREFERENCE_KEY = 'chat.web_search.client_tools_preferred'
const MODEL_TOOLS_PREFERRED_KEY = 'chat.web_search.model_tools_preferred'
const WEB_SEARCH_PREFERENCE_SEEDERS = seeders.filter(
  ({ name }) => name === 'webSearchPreferenceUpgrade' || name === 'preference'
)

describe('WebSearchPreferenceUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = (key: string) =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  const writePreference = (key: string, value: boolean) => {
    dbh.db
      .insert(preferenceTable)
      .values({ scope: 'default', key, value })
      .onConflictDoUpdate({
        target: [preferenceTable.scope, preferenceTable.key],
        set: { value }
      })
      .run()
  }

  it('defaults a new installation to model-native web tools', () => {
    new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(true)
    expect(readPreference(LEGACY_PREFERENCE_KEY)).toBeUndefined()
  })

  it.each([
    { legacyValue: false, expectedValue: true },
    { legacyValue: true, expectedValue: false }
  ])('inverts a legacy $legacyValue preference during a direct upgrade', ({ legacyValue, expectedValue }) => {
    writePreference(LEGACY_PREFERENCE_KEY, legacyValue)

    new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(expectedValue)
    expect(readPreference(LEGACY_PREFERENCE_KEY)).toBeUndefined()
  })

  it('does not overwrite a later user choice when seeders run again', () => {
    writePreference(LEGACY_PREFERENCE_KEY, false)
    const runner = new SeedRunner(dbh.db)

    runner.runAll(WEB_SEARCH_PREFERENCE_SEEDERS)
    expect(readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(true)

    writePreference(MODEL_TOOLS_PREFERRED_KEY, false)
    runner.runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(false)
  })
})
