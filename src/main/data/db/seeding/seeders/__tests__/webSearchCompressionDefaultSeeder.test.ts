import { preferenceTable } from '@data/db/schemas/preference'
import { WebSearchCompressionDefaultSeeder } from '@data/db/seeding/seeders/webSearchCompressionDefaultSeeder'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const METHOD_KEY = 'chat.web_search.compression.method'
const CUTOFF_LIMIT_KEY = 'chat.web_search.compression.cutoff_limit'

describe('WebSearchCompressionDefaultSeeder', () => {
  const dbh = setupTestDatabase()

  async function readValue(key: string) {
    const [preference] = await dbh.db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .limit(1)
    return preference?.value
  }

  it('upgrades the complete legacy default pair', async () => {
    await dbh.db.insert(preferenceTable).values([
      { scope: 'default', key: METHOD_KEY, value: 'none' },
      { scope: 'default', key: CUTOFF_LIMIT_KEY, value: 2000 }
    ])

    new WebSearchCompressionDefaultSeeder().run(dbh.db)

    expect(await readValue(METHOD_KEY)).toBe('cutoff')
    expect(await readValue(CUTOFF_LIMIT_KEY)).toBe(10000)
  })

  it('upgrades the legacy key when the other half of the pair is missing', async () => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key: METHOD_KEY, value: 'none' })

    new WebSearchCompressionDefaultSeeder().run(dbh.db)

    expect(await readValue(METHOD_KEY)).toBe('cutoff')
    expect(await readValue(CUTOFF_LIMIT_KEY)).toBeUndefined()
  })

  it('preserves a user-owned compression pair', async () => {
    await dbh.db.insert(preferenceTable).values([
      { scope: 'default', key: METHOD_KEY, value: 'none' },
      { scope: 'default', key: CUTOFF_LIMIT_KEY, value: 5000 }
    ])

    new WebSearchCompressionDefaultSeeder().run(dbh.db)

    expect(await readValue(METHOD_KEY)).toBe('none')
    expect(await readValue(CUTOFF_LIMIT_KEY)).toBe(5000)
  })

  it('leaves a fresh preference table empty for PreferenceSeeder', async () => {
    new WebSearchCompressionDefaultSeeder().run(dbh.db)

    expect(await dbh.db.select().from(preferenceTable)).toHaveLength(0)
  })
})
