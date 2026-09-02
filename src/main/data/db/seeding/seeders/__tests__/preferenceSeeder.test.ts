import { preferenceTable } from '@data/db/schemas/preference'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('PreferenceSeeder', () => {
  const dbh = setupTestDatabase()
  const toolbarKey = 'chat.input.toolbar.pinned_tools'
  const modelToolsPreferredKey = 'chat.web_search.model_tools_preferred'

  it('should insert all default preferences into empty table', async () => {
    const seed = new PreferenceSeeder()
    seed.run(dbh.db)

    const rows = await dbh.db.select().from(preferenceTable)
    const defaultKeys = Object.keys(DefaultPreferences.default)
    const seededKeys = rows.filter((r) => r.scope === 'default').map((r) => r.key)
    for (const k of defaultKeys) {
      expect(seededKeys).toContain(k)
    }
  })

  it('should only insert missing preferences when some exist', async () => {
    const allDefaults = Object.entries(DefaultPreferences.default).map(([key, value]) => ({
      scope: 'default',
      key,
      value
    }))
    const [first, ...rest] = allDefaults
    // Pre-insert one preference
    await dbh.db.insert(preferenceTable).values([first])
    // Customise its value so we can check the seeder did not overwrite it.
    await dbh.db
      .update(preferenceTable)
      .set({ value: '__customized__' as unknown as never })
      .where(and(eq(preferenceTable.scope, first.scope), eq(preferenceTable.key, first.key)))

    const seed = new PreferenceSeeder()
    seed.run(dbh.db)

    const rows = await dbh.db.select().from(preferenceTable)
    expect(rows.length).toBe(allDefaults.length)

    const customised = rows.find((r) => r.scope === first.scope && r.key === first.key)
    expect(customised?.value).toBe('__customized__')

    // Remaining keys present
    for (const entry of rest) {
      expect(rows.find((r) => r.scope === entry.scope && r.key === entry.key)).toBeDefined()
    }
  })

  it('should not insert when all preferences exist', async () => {
    const allDefaults = Object.entries(DefaultPreferences.default).map(([key, value]) => ({
      scope: 'default',
      key,
      value
    }))
    await dbh.db.insert(preferenceTable).values(allDefaults)
    const before = (await dbh.db.select().from(preferenceTable)).length

    const seed = new PreferenceSeeder()
    seed.run(dbh.db)

    const after = (await dbh.db.select().from(preferenceTable)).length
    expect(after).toBe(before)
  })

  it('keeps clear context unpinned in the default chat toolbar', async () => {
    new PreferenceSeeder().run(dbh.db)

    const [toolbar] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, toolbarKey)))
    expect(toolbar.value).toEqual(['composer:new-conversation', 'web-search'])
  })

  it('defaults web tools to model-native capabilities', async () => {
    new PreferenceSeeder().run(dbh.db)

    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, modelToolsPreferredKey)))
    expect(preference?.value).toBe(true)
  })

  it('does not overwrite a persisted sidebar favorites order that differs from the generated default', async () => {
    const sidebarKey = 'ui.sidebar.favorites'
    const persisted = [
      { id: 'agents', type: 'app' },
      { id: 'assistants', type: 'app' },
      { id: 'translate', type: 'app' }
    ]
    const generatedDefault = DefaultPreferences.default[sidebarKey]

    expect(generatedDefault[0]).toEqual({ id: 'assistants', type: 'app' })
    expect(persisted).not.toEqual(generatedDefault)

    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: sidebarKey,
      value: persisted
    })

    new PreferenceSeeder().run(dbh.db)

    const [row] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, sidebarKey)))
    expect(row.value).toEqual(persisted)
  })
})
