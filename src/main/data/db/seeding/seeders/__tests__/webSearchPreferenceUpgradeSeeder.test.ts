import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

const CLIENT_WEB_TOOLS_PREFERRED_KEY = 'chat.web_search.client_tools_preferred'
const WEB_SEARCH_PREFERENCE_SEEDERS = seeders.filter(
  ({ name }) => name === 'webSearchPreferenceUpgrade' || name === 'preference'
)

describe('WebSearchPreferenceUpgradeSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = async () => {
    const [row] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, CLIENT_WEB_TOOLS_PREFERRED_KEY)))
    return row?.value
  }

  const writePreference = async (value: boolean) => {
    await dbh.db
      .insert(preferenceTable)
      .values({ scope: 'default', key: CLIENT_WEB_TOOLS_PREFERRED_KEY, value })
      .onConflictDoUpdate({
        target: [preferenceTable.scope, preferenceTable.key],
        set: { value }
      })
  }

  it('uses model-native web tools for a new installation', async () => {
    new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(await readPreference()).toBe(false)
  })

  it('resets an existing client-first preference to model-first', async () => {
    await writePreference(true)

    new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(await readPreference()).toBe(false)
  })

  it('does not overwrite an existing model-first preference', async () => {
    await writePreference(false)

    new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(await readPreference()).toBe(false)
  })

  it('allows users to prefer configured services again after the upgrade', async () => {
    await writePreference(true)
    const runner = new SeedRunner(dbh.db)

    runner.runAll(WEB_SEARCH_PREFERENCE_SEEDERS)
    expect(await readPreference()).toBe(false)

    await writePreference(true)
    runner.runAll(WEB_SEARCH_PREFERENCE_SEEDERS)

    expect(await readPreference()).toBe(true)
  })
})
