import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

import { IllustrationPreferenceUpgradeSeeder } from '../IllustrationPreferenceUpgradeSeeder'

const ILLUSTRATION_SEEDERS = seeders.filter(
  ({ name }) => name === 'illustrationPreferenceUpgrade' || name === 'preference'
)

describe('IllustrationPreferenceUpgradeSeeder', () => {
  const dbh = setupTestDatabase()
  const readPreference = (key: string) =>
    dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  // Catches silently dropping an existing exact-count choice or enabling illustrations while off.
  it.each([
    { mode: 'auto', forceCount: true, expectedMode: 'on', expectedTarget: 3 },
    { mode: 'on', forceCount: true, expectedMode: 'on', expectedTarget: 3 },
    { mode: 'off', forceCount: true, expectedMode: 'off', expectedTarget: 3 },
    { mode: 'auto', forceCount: false, expectedMode: 'auto', expectedTarget: 5 },
    { mode: 'on', forceCount: false, expectedMode: 'on', expectedTarget: 1 },
    { mode: 'off', forceCount: false, expectedMode: 'off', expectedTarget: 5 }
  ])('converts $mode with exact count $forceCount', ({ mode, forceCount, expectedMode, expectedTarget }) => {
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: 'chat.illustration.mode', value: mode },
        { scope: 'default', key: 'chat.illustration.force_count', value: forceCount },
        { scope: 'default', key: 'chat.illustration.max_count', value: 3 },
        { scope: 'default', key: 'chat.illustration.target_count', value: 5 }
      ])
      .run()

    new SeedRunner(dbh.db).runAll(ILLUSTRATION_SEEDERS)

    expect(readPreference('chat.illustration.mode')).toBe(expectedMode)
    expect(readPreference('chat.illustration.target_count')).toBe(expectedTarget)
    expect(readPreference('chat.illustration.max_count')).toBe(3)
    expect(readPreference('chat.illustration.force_count')).toBeUndefined()
  })

  it('preserves the effective target of an existing exact-count configuration', () => {
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: 'chat.illustration.mode', value: 'on' },
        { scope: 'default', key: 'chat.illustration.force_count', value: true },
        { scope: 'default', key: 'chat.illustration.max_count', value: 3 },
        { scope: 'default', key: 'chat.illustration.target_count', value: 2 }
      ])
      .run()

    new SeedRunner(dbh.db).runAll(ILLUSTRATION_SEEDERS)

    expect(readPreference('chat.illustration.target_count')).toBe(2)
  })

  // Catches the upgrade replaying on restart and clamping the new independent target to the automatic maximum.
  it('keeps subsequent user choices even if the conversion is run again', () => {
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: 'chat.illustration.mode', value: 'auto' },
        { scope: 'default', key: 'chat.illustration.force_count', value: true },
        { scope: 'default', key: 'chat.illustration.target_count', value: 2 }
      ])
      .run()
    const runner = new SeedRunner(dbh.db)
    runner.runAll(ILLUSTRATION_SEEDERS)
    dbh.db
      .update(preferenceTable)
      .set({ value: 7 })
      .where(eq(preferenceTable.key, 'chat.illustration.target_count'))
      .run()
    dbh.db.update(preferenceTable).set({ value: 'auto' }).where(eq(preferenceTable.key, 'chat.illustration.mode')).run()

    runner.runAll(ILLUSTRATION_SEEDERS)
    new IllustrationPreferenceUpgradeSeeder().run(dbh.db)

    expect(readPreference('chat.illustration.mode')).toBe('auto')
    expect(readPreference('chat.illustration.target_count')).toBe(7)
  })

  it('keeps new installations off with independent default quantities and no retired switch', () => {
    new SeedRunner(dbh.db).runAll(ILLUSTRATION_SEEDERS)

    expect(readPreference('chat.illustration.mode')).toBe('off')
    expect(readPreference('chat.illustration.max_count')).toBe(1)
    expect(readPreference('chat.illustration.target_count')).toBe(1)
    expect(readPreference('chat.illustration.force_count')).toBeUndefined()
  })
})
