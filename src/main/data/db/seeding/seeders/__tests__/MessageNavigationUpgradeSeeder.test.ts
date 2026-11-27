import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

const key = 'chat.message.navigation_mode'
const navigationSeeders = seeders.filter(({ name }) => name === 'messageNavigationUpgrade' || name === 'preference')

describe('MessageNavigationUpgradeSeeder', () => {
  const dbh = setupTestDatabase()
  const readMode = () =>
    dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .get()?.value

  it.each(['buttons', 'none', 'anchor'] as const)(
    'upgrades %s without changing an explicit supported choice',
    (mode) => {
      dbh.db.insert(preferenceTable).values({ scope: 'default', key, value: mode }).run()

      new SeedRunner(dbh.db).runAll(navigationSeeders)

      expect(readMode()).toBe(mode === 'buttons' ? 'anchor' : mode)
    }
  )

  it('defaults new installations to anchors', () => {
    new SeedRunner(dbh.db).runAll(navigationSeeders)

    expect(readMode()).toBe('anchor')
  })

  it('preserves a user disabling anchors after the upgrade on subsequent startups', () => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key, value: 'buttons' }).run()
    new SeedRunner(dbh.db).runAll(navigationSeeders)
    expect(readMode()).toBe('anchor')
    dbh.db.update(preferenceTable).set({ value: 'none' }).where(eq(preferenceTable.key, key)).run()

    new SeedRunner(dbh.db).runAll(navigationSeeders)

    expect(readMode()).toBe('none')
  })
})
