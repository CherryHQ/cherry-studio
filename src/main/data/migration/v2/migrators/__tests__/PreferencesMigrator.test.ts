import { preferenceTable } from '@data/db/schemas/preference'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { DexieSettingsReader, type DexieSettingsRecord } from '../../utils/DexieSettingsReader'
import { LocalStorageReader } from '../../utils/LocalStorageReader'
import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { PreferencesMigrator } from '../PreferencesMigrator'

interface SeedSources {
  redux?: Record<string, unknown>
  electronStore?: Record<string, unknown>
  dexieSettings?: DexieSettingsRecord[]
  localStorage?: Array<{ key: string; value: unknown }>
}

/**
 * Build a MigrationContext for PreferencesMigrator. Uses the real source
 * readers (ReduxStateReader / DexieSettingsReader / LocalStorageReader) so
 * that fixtures double as documentation of the data shape each reader
 * accepts. ElectronStore is stubbed to match the read-only contract on
 * `MigrationContext.sources.electronStore`.
 */
function createTestContext(sources: SeedSources, db: unknown): MigrationContext {
  return {
    sources: {
      electronStore: {
        get: <T>(key: string) => sources.electronStore?.[key] as T | undefined
      },
      reduxState: new ReduxStateReader(sources.redux ?? {}),
      dexieExport: {
        readTable: async () => [],
        createStreamReader: async () => null,
        tableExists: async () => false
      },
      dexieSettings: new DexieSettingsReader(sources.dexieSettings ?? []),
      localStorage: new LocalStorageReader(sources.localStorage ?? []),
      knowledgeVectorSource: { hasSource: () => false },
      legacyHomeConfig: { exists: () => false, read: () => null }
    },
    db,
    sharedData: new Map<string, unknown>(),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    },
    paths: {}
  } as unknown as MigrationContext
}

async function selectByKey(db: any, key: string) {
  return db
    .select()
    .from(preferenceTable)
    .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
}

async function countDefaultRows(db: any): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(preferenceTable)
    .where(eq(preferenceTable.scope, 'default'))
  return Number(row?.c ?? 0)
}

describe('PreferencesMigrator', () => {
  const dbh = setupTestDatabase()
  let migrator: PreferencesMigrator

  beforeEach(() => {
    migrator = new PreferencesMigrator()
  })

  describe('prepare', () => {
    it('reads simple Redux mappings (settings.language → app.language)', async () => {
      const ctx = createTestContext({ redux: { settings: { language: 'zh-CN' } } }, dbh.db)
      const result = await migrator.prepare(ctx)
      expect(result.success).toBe(true)

      await migrator.execute(ctx)
      const rows = await selectByKey(dbh.db, 'app.language')
      expect(rows).toHaveLength(1)
      expect(rows[0].value).toBe('zh-CN')
    })

    it('reads ElectronStore mappings (ZoomFactor → app.zoom_factor)', async () => {
      const ctx = createTestContext({ electronStore: { ZoomFactor: 1.25 } }, dbh.db)
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await selectByKey(dbh.db, 'app.zoom_factor')
      expect(rows).toHaveLength(1)
      expect(rows[0].value).toBe(1.25)
    })

    it('reads Dexie-settings mappings (translate:scroll:sync → feature.translate.page.scroll_sync)', async () => {
      const ctx = createTestContext({ dexieSettings: [{ id: 'translate:scroll:sync', value: true }] }, dbh.db)
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await selectByKey(dbh.db, 'feature.translate.page.scroll_sync')
      expect(rows).toHaveLength(1)
      expect(rows[0].value).toBe(true)
    })

    it('falls back to DefaultPreferences when source value is missing', async () => {
      const ctx = createTestContext({}, dbh.db)
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      // ui.theme_mode default is 'system'; app.zoom_factor default is 1
      const theme = await selectByKey(dbh.db, 'ui.theme_mode')
      expect(theme).toHaveLength(1)
      expect(theme[0].value).toBe('system')
      const zoom = await selectByKey(dbh.db, 'app.zoom_factor')
      expect(zoom).toHaveLength(1)
      expect(zoom[0].value).toBe(1)
    })

    it('skips items whose source is empty AND default is null', async () => {
      const ctx = createTestContext({}, dbh.db)
      const result = await migrator.prepare(ctx)
      expect(result.success).toBe(true)

      await migrator.execute(ctx)
      // app.language default is null — must be skipped, not inserted
      const rows = await selectByKey(dbh.db, 'app.language')
      expect(rows).toHaveLength(0)

      const validate = await migrator.validate(ctx)
      expect(validate.stats.skippedCount).toBeGreaterThan(0)
    })

    it('routes shortcut array source through complex mapping (array → multi-key)', async () => {
      const ctx = createTestContext(
        {
          redux: {
            shortcuts: {
              shortcuts: [
                { key: 'zoom_in', shortcut: ['CommandOrControl', '='], enabled: true },
                { key: 'show_settings', shortcut: ['CommandOrControl', ','], enabled: false }
              ]
            }
          }
        },
        dbh.db
      )
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const zoomRows = await selectByKey(dbh.db, 'shortcut.general.zoom_in')
      expect(zoomRows).toHaveLength(1)
      expect(zoomRows[0].value).toEqual({ binding: ['CommandOrControl', '='], enabled: true })

      const settingsRows = await selectByKey(dbh.db, 'shortcut.general.show_settings')
      expect(settingsRows).toHaveLength(1)
      expect(settingsRows[0].value).toEqual({ binding: ['CommandOrControl', ','], enabled: false })
    })

    it('routes websearch.compressionConfig through complex mapping (1 → N split)', async () => {
      const ctx = createTestContext(
        {
          redux: {
            websearch: {
              compressionConfig: { method: 'cutoff', cutoffLimit: 2000, cutoffUnit: 'token' }
            }
          }
        },
        dbh.db
      )
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const method = await selectByKey(dbh.db, 'chat.web_search.compression.method')
      const limit = await selectByKey(dbh.db, 'chat.web_search.compression.cutoff_limit')
      expect(method[0]?.value).toBe('cutoff')
      expect(limit[0]?.value).toBe(2000)
      expect(await selectByKey(dbh.db, 'chat.web_search.compression.cutoff_unit')).toHaveLength(0)
    })

    it('merges preprocess + ocr providers through complex mapping (N → 1 merge)', async () => {
      const ctx = createTestContext(
        {
          redux: {
            preprocess: {
              providers: [
                {
                  id: 'mineru',
                  apiKey: 'pp-test-key',
                  apiHost: 'https://override.preprocess.example.com'
                }
              ]
            },
            ocr: {
              providers: [
                {
                  id: 'mistral',
                  config: { accessToken: 'ocr-test-key' }
                }
              ]
            }
          }
        },
        dbh.db
      )
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await selectByKey(dbh.db, 'feature.file_processing.overrides')
      expect(rows).toHaveLength(1)
      const overrides = rows[0].value as Record<string, { apiKeys?: string[] }>
      expect(overrides.mineru?.apiKeys).toEqual(['pp-test-key'])
      expect(overrides.mistral?.apiKeys).toEqual(['ocr-test-key'])
    })

    it('handles malformed complex-mapping source without aborting other prefs', async () => {
      // shortcuts source must be an array; transformShortcuts logs and returns
      // {} when given a non-array, so prepare succeeds with no shortcut.* rows
      // emitted while unrelated mappings (theme) still flow through.
      const ctx = createTestContext(
        {
          redux: {
            shortcuts: { shortcuts: { not: 'an array' } },
            settings: { theme: 'dark' }
          }
        },
        dbh.db
      )
      const result = await migrator.prepare(ctx)
      expect(result.success).toBe(true)

      await migrator.execute(ctx)
      const all = await dbh.db.select().from(preferenceTable).where(eq(preferenceTable.scope, 'default'))
      const shortcutRows = all.filter((r: { key: string }) => r.key.startsWith('shortcut.'))
      expect(shortcutRows).toHaveLength(0)

      const theme = await selectByKey(dbh.db, 'ui.theme_mode')
      expect(theme[0]?.value).toBe('dark')
    })
  })

  describe('execute', () => {
    it('writes rows with scope="default" and timestamps populated', async () => {
      const ctx = createTestContext({ redux: { settings: { language: 'zh-CN' } } }, dbh.db)
      const prep = await migrator.prepare(ctx)
      const exec = await migrator.execute(ctx)
      expect(exec.success).toBe(true)
      expect(exec.processedCount).toBe(prep.itemCount)

      const [langRow] = await selectByKey(dbh.db, 'app.language')
      expect(langRow.scope).toBe('default')
      expect(langRow.createdAt).toBeGreaterThan(0)
      expect(langRow.updatedAt).toBeGreaterThan(0)
    })

    it('completes batched insert when prepared items exceed BATCH_SIZE=100', async () => {
      // Empty source still produces well over 100 default-fallback +
      // complex-mapping items, exercising the BATCH_SIZE=100 inner loop.
      const ctx = createTestContext({}, dbh.db)
      const prep = await migrator.prepare(ctx)
      expect(prep.itemCount).toBeGreaterThan(100)

      const exec = await migrator.execute(ctx)
      expect(exec.success).toBe(true)
      expect(await countDefaultRows(dbh.db)).toBe(prep.itemCount)
    })

    it('round-trips JSON-encoded structured values through the value column', async () => {
      const ctx = createTestContext(
        {
          redux: {
            shortcuts: {
              shortcuts: [{ key: 'zoom_in', shortcut: ['CommandOrControl', '='], enabled: true }]
            }
          }
        },
        dbh.db
      )
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const [row] = await selectByKey(dbh.db, 'shortcut.general.zoom_in')
      expect(row.value).toEqual({ binding: ['CommandOrControl', '='], enabled: true })
    })

    it('rolls back transaction when an insert collides with an existing row', async () => {
      // Pre-seed a colliding primary key so the migrator's transaction throws
      // mid-batch. The whole txn must roll back (no partial inserts) while the
      // pre-existing row stays untouched.
      await dbh.db.insert(preferenceTable).values({
        scope: 'default',
        key: 'app.language',
        value: 'pre-existing',
        createdAt: 1,
        updatedAt: 1
      })

      const ctx = createTestContext({ redux: { settings: { language: 'zh-CN' } } }, dbh.db)
      await migrator.prepare(ctx)
      const exec = await migrator.execute(ctx)
      expect(exec.success).toBe(false)
      expect(exec.processedCount).toBe(0)

      expect(await countDefaultRows(dbh.db)).toBe(1)
      const [lang] = await selectByKey(dbh.db, 'app.language')
      expect(lang.value).toBe('pre-existing')
    })
  })

  describe('validate', () => {
    it('reports success when target count matches source count', async () => {
      const ctx = createTestContext(
        {
          redux: { settings: { language: 'zh-CN' } },
          electronStore: { ZoomFactor: 1.5 }
        },
        dbh.db
      )
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const validate = await migrator.validate(ctx)
      expect(validate.success).toBe(true)
      expect(validate.errors).toHaveLength(0)
      expect(validate.stats.targetCount).toBe(validate.stats.sourceCount)
    })

    it('reports an error when a prepared critical key is missing in DB', async () => {
      const ctx = createTestContext({ redux: { settings: { language: 'zh-CN' } } }, dbh.db)
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      // Simulate post-migration corruption / accidental deletion
      await dbh.db
        .delete(preferenceTable)
        .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'app.language')))

      const validate = await migrator.validate(ctx)
      expect(validate.success).toBe(false)
      expect(validate.errors.some((e) => e.key === 'app.language')).toBe(true)
    })

    it('exposes skippedCount in validate stats', async () => {
      const ctx = createTestContext({}, dbh.db)
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const validate = await migrator.validate(ctx)
      expect(validate.stats.skippedCount).toBeGreaterThan(0)
    })
  })

  describe('lifecycle + metadata', () => {
    it('runs prepare → execute → validate end-to-end on mixed sources', async () => {
      const ctx = createTestContext(
        {
          redux: {
            settings: { language: 'zh-CN', theme: 'dark' },
            websearch: {
              compressionConfig: { method: 'cutoff', cutoffLimit: 1000, cutoffUnit: 'char' }
            }
          },
          electronStore: { ZoomFactor: 1.1 },
          dexieSettings: [{ id: 'translate:scroll:sync', value: true }]
        },
        dbh.db
      )
      const prep = await migrator.prepare(ctx)
      const exec = await migrator.execute(ctx)
      const val = await migrator.validate(ctx)
      expect(prep.success).toBe(true)
      expect(exec.success).toBe(true)
      expect(val.success).toBe(true)

      const [lang] = await selectByKey(dbh.db, 'app.language')
      expect(lang.value).toBe('zh-CN')
      const [zoom] = await selectByKey(dbh.db, 'app.zoom_factor')
      expect(zoom.value).toBe(1.1)
      const [scroll] = await selectByKey(dbh.db, 'feature.translate.page.scroll_sync')
      expect(scroll.value).toBe(true)
      const [method] = await selectByKey(dbh.db, 'chat.web_search.compression.method')
      expect(method.value).toBe('cutoff')
    })

    it('declares correct id, name, order metadata', () => {
      expect(migrator.id).toBe('preferences')
      expect(migrator.name).toBe('Preferences')
      expect(migrator.order).toBe(1)
    })

    it('reset() clears prepared items so a second prepare reflects only the new context', async () => {
      // ctx1 supplies a real value for app.language; ctx2 omits it so the
      // skip-path kicks in. Without reset(), ctx2's preparedItems would still
      // carry ctx1's app.language entry and the count delta would be 0.
      const ctx1 = createTestContext({ redux: { settings: { language: 'zh-CN' } } }, dbh.db)
      const r1 = await migrator.prepare(ctx1)

      migrator.reset()

      const ctx2 = createTestContext({}, dbh.db)
      const r2 = await migrator.prepare(ctx2)

      expect(r2.itemCount).toBe(r1.itemCount - 1)

      await migrator.execute(ctx2)
      const langRows = await selectByKey(dbh.db, 'app.language')
      expect(langRows).toHaveLength(0)
    })
  })
})
