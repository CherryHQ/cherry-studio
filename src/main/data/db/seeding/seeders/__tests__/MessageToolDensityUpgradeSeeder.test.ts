import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

const LEGACY_PREFERENCE_KEY = 'chat.message.thought.auto_collapse'
const DENSITY_KEY = 'chat.message.density'
const DENSITY_SEEDERS = seeders.filter(({ name }) => name === 'messageToolDensityUpgrade' || name === 'preference')

describe('MessageToolDensityUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = (key: string) =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  const writePreference = (key: string, value: boolean | string) => {
    dbh.db
      .insert(preferenceTable)
      .values({ scope: 'default', key, value })
      .onConflictDoUpdate({
        target: [preferenceTable.scope, preferenceTable.key],
        set: { value }
      })
      .run()
  }

  it('leaves a fresh installation on the compact default', () => {
    new SeedRunner(dbh.db).runAll(DENSITY_SEEDERS)

    expect(readPreference(DENSITY_KEY)).toBe('compact')
    expect(readPreference(LEGACY_PREFERENCE_KEY)).toBeUndefined()
  })

  it.each([
    { legacyValue: true, expectedValue: 'compact' },
    { legacyValue: false, expectedValue: 'detailed' }
  ])(
    'folds a legacy $legacyValue auto-collapse into $expectedValue during a direct upgrade',
    ({ legacyValue, expectedValue }) => {
      writePreference(LEGACY_PREFERENCE_KEY, legacyValue)

      new SeedRunner(dbh.db).runAll(DENSITY_SEEDERS)

      expect(readPreference(DENSITY_KEY)).toBe(expectedValue)
      expect(readPreference(LEGACY_PREFERENCE_KEY)).toBeUndefined()
    }
  )

  it.each(['balanced', 'detailed'] as const)(
    'keeps the density value %s a returning user already has',
    (existingValue) => {
      writePreference(LEGACY_PREFERENCE_KEY, true)
      writePreference(DENSITY_KEY, existingValue)

      new SeedRunner(dbh.db).runAll(DENSITY_SEEDERS)

      expect(readPreference(DENSITY_KEY)).toBe(existingValue)
      expect(readPreference(LEGACY_PREFERENCE_KEY)).toBeUndefined()
    }
  )

  it('does not overwrite a later user choice when seeders run again', () => {
    writePreference(LEGACY_PREFERENCE_KEY, false)
    const runner = new SeedRunner(dbh.db)

    runner.runAll(DENSITY_SEEDERS)
    expect(readPreference(DENSITY_KEY)).toBe('detailed')

    writePreference(DENSITY_KEY, 'balanced')
    runner.runAll(DENSITY_SEEDERS)

    expect(readPreference(DENSITY_KEY)).toBe('balanced')
  })
})
