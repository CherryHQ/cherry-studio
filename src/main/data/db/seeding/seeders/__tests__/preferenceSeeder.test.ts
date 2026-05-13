import { preferenceTable } from '@data/db/schemas/preference'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('PreferenceSeeder', () => {
  const dbh = setupTestDatabase()

  it('should insert all default preferences into empty table', async () => {
    const seed = new PreferenceSeeder()
    await seed.run(dbh.db)

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
    await seed.run(dbh.db)

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
    await seed.run(dbh.db)

    const after = (await dbh.db.select().from(preferenceTable)).length
    expect(after).toBe(before)
  })

  it('should delete obsolete default preferences', async () => {
    await dbh.db.insert(preferenceTable).values({
      scope: 'default',
      key: 'app.settings.open_target',
      value: 'app'
    })

    const seed = new PreferenceSeeder()
    await seed.run(dbh.db)

    const rows = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'app.settings.open_target')))

    expect(rows).toHaveLength(0)
  })

  it('should add agents to an existing visible sidebar icon preference', async () => {
    await dbh.db.insert(preferenceTable).values([
      {
        scope: 'default',
        key: 'ui.sidebar.icons.visible',
        value: ['assistants', 'store', 'translate']
      },
      {
        scope: 'default',
        key: 'ui.sidebar.icons.invisible',
        value: []
      }
    ])

    const seed = new PreferenceSeeder()
    await seed.run(dbh.db)

    const [visible] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar.icons.visible')))

    expect(visible.value).toEqual(['assistants', 'agents', 'store', 'translate'])
  })

  it('should not add agents to visible sidebar icons when agents is hidden', async () => {
    await dbh.db.insert(preferenceTable).values([
      {
        scope: 'default',
        key: 'ui.sidebar.icons.visible',
        value: ['assistants', 'store', 'translate']
      },
      {
        scope: 'default',
        key: 'ui.sidebar.icons.invisible',
        value: ['agents']
      }
    ])

    const seed = new PreferenceSeeder()
    await seed.run(dbh.db)

    const [visible] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar.icons.visible')))

    expect(visible.value).toEqual(['assistants', 'store', 'translate'])
  })
})
