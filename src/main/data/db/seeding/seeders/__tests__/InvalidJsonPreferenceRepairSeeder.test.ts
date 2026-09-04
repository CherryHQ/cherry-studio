import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'
import { hashObject } from '@data/db/seeding/hashObject'
import { InvalidJsonPreferenceRepairSeeder } from '@data/db/seeding/seeders/InvalidJsonPreferenceRepairSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('InvalidJsonPreferenceRepairSeeder', () => {
  const dbh = setupTestDatabase()
  const modelPreferenceKeys = [
    'chat.context_settings.compress.model_id',
    'chat.default_model_id',
    'feature.openclaw.selected_model_id',
    'feature.paintings.default_model_id',
    'feature.quick_assistant.model_id',
    'feature.translate.model_id'
  ]

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

    new SeedRunner(dbh.db).runAll([new InvalidJsonPreferenceRepairSeeder()])

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

    new InvalidJsonPreferenceRepairSeeder().run(dbh.db)

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

    new InvalidJsonPreferenceRepairSeeder().run(dbh.db)

    const [legacy] = dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'legacy.unknown')))
      .all()
    expect(legacy.value).toBe('plain-value')
  })
})
