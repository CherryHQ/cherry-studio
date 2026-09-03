import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'
import { hashObject } from '@data/db/seeding/hashObject'
import { PreferenceSeeder } from '@data/db/seeding/seeders/preferenceSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('PreferenceSeeder', () => {
  const dbh = setupTestDatabase()
  const toolbarKey = 'chat.input.toolbar.pinned_tools'
  const modelPreferenceKeys = [
    'chat.context_settings.compress.model_id',
    'chat.default_model_id',
    'feature.openclaw.selected_model_id',
    'feature.paintings.default_model_id',
    'feature.quick_assistant.model_id',
    'feature.translate.model_id'
  ]
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

  it.each(modelPreferenceKeys)('repairs a preserved 2.0.x plain model id for %s', (modelPreferenceKey) => {
    mockMainLoggerService.warn.mockClear()
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: modelPreferenceKey, value: 'deepseek::deepseek-v4-flash' },
        { scope: 'default', key: 'app.user.name', value: 'Cherry User' }
      ])
      .run()
    dbh.sqlite
      .prepare('UPDATE preference SET value = ? WHERE scope = ? AND key = ?')
      .run('deepseek::deepseek-v4-flash', 'default', modelPreferenceKey)
    dbh.db
      .insert(appStateTable)
      .values({ key: 'seed:preference', value: { version: hashObject(DefaultPreferences) } })
      .run()

    new SeedRunner(dbh.db).runAll([new PreferenceSeeder()])

    const rows = dbh.db.select().from(preferenceTable).all()
    expect(rows.find((row) => row.key === modelPreferenceKey)?.value).toBe('deepseek::deepseek-v4-flash')
    expect(rows.find((row) => row.key === 'app.user.name')?.value).toBe('Cherry User')
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Repaired invalid JSON preference value', {
      action: 'encoded legacy model id',
      key: modelPreferenceKey,
      scope: 'default'
    })
  })

  it('resets another malformed preference to its default', () => {
    mockMainLoggerService.warn.mockClear()
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'app.zoom_factor', value: 1.25 }).run()
    dbh.sqlite
      .prepare("UPDATE preference SET value = ? WHERE scope = 'default' AND key = 'app.zoom_factor'")
      .run('not-json')

    new PreferenceSeeder().run(dbh.db)

    const [zoomFactor] = dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'app.zoom_factor')))
      .all()
    expect(zoomFactor.value).toBe(DefaultPreferences.default['app.zoom_factor'])
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Repaired invalid JSON preference value', {
      action: 'reset to default',
      key: 'app.zoom_factor',
      scope: 'default'
    })
  })

  it('preserves an unknown malformed preference as a readable string', () => {
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: 'legacy.unknown', value: 'plain-value' }).run()
    dbh.sqlite
      .prepare("UPDATE preference SET value = ? WHERE scope = 'default' AND key = 'legacy.unknown'")
      .run('plain-value')

    new PreferenceSeeder().run(dbh.db)

    const [legacy] = dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'legacy.unknown')))
      .all()
    expect(legacy.value).toBe('plain-value')
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
      { id: 'assistants', type: 'app' },
      { id: 'agents', type: 'app' },
      { id: 'translate', type: 'app' }
    ]
    const generatedDefault = DefaultPreferences.default[sidebarKey]

    expect(generatedDefault[0]).toEqual({ id: 'agents', type: 'app' })
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
