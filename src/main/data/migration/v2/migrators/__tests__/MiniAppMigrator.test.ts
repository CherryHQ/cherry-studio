import { miniAppTable } from '@data/db/schemas/miniapp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { MiniAppMigrator } from '../MiniAppMigrator'

/**
 * Build a MigrationContext with a real DB (from setupTestDatabase) and a
 * ReduxStateReader seeded from plain data.  Only the fields used by
 * MiniAppMigrator (sources.reduxState + db) are populated.
 */
function createTestContext(reduxData: Record<string, unknown> = {}, db: any) {
  return {
    sources: {
      electronStore: { get: () => undefined },
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: { readTable: async () => [], createStreamReader: async () => null, tableExists: async () => false },
      dexieSettings: { keys: () => [], get: () => undefined },
      localStorage: { get: () => undefined, getAll: () => [] },
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
    } as any,
    paths: {} as any
  }
}

describe('MiniAppMigrator', () => {
  const dbh = setupTestDatabase()
  let migrator: MiniAppMigrator

  beforeEach(() => {
    migrator = new MiniAppMigrator()
  })

  describe('prepare', () => {
    it('should return success with 0 items when no miniapps state', async () => {
      const ctx = createTestContext({}, dbh.db) as any
      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should return success with 0 items when miniapps is null', async () => {
      const ctx = createTestContext({ minapps: null }, dbh.db) as any
      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should prepare apps from all status groups', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'app1', name: 'App 1', url: 'https://1.com' },
              { id: 'app2', name: 'App 2', url: 'https://2.com' }
            ],
            disabled: [{ id: 'app3', name: 'App 3', url: 'https://3.com' }],
            pinned: [{ id: 'app4', name: 'App 4', url: 'https://4.com' }]
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(4)
    })

    it('should deduplicate apps with same id (pinned takes priority)', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'Enabled App', url: 'https://1.com', type: 'Default' }],
            pinned: [{ id: 'app1', name: 'Pinned App', url: 'https://1.com', type: 'Default' }]
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should deduplicate apps appearing in all three status groups, keeping pinned', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'Enabled', url: 'https://1.com' }],
            disabled: [{ id: 'app1', name: 'Disabled', url: 'https://1.com' }],
            pinned: [{ id: 'app1', name: 'Pinned', url: 'https://1.com' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app1'))
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pinned')
      expect(rows[0].name).toBe('Pinned')
    })

    it('should keep enabled over disabled when no pinned entry exists', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'Enabled', url: 'https://1.com' }],
            disabled: [{ id: 'app1', name: 'Disabled', url: 'https://1.com' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app1'))
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('enabled')
      expect(rows[0].name).toBe('Enabled')
    })

    it('should skip apps without valid id', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'valid', name: 'Valid App', url: 'https://v.com' },
              { name: 'No ID App', url: 'https://x.com' },
              { id: 123, name: 'Number ID', url: 'https://n.com' },
              null,
              undefined
            ]
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.length).toBeGreaterThan(0)
    })

    it('should handle empty arrays in status groups', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [],
            disabled: [],
            pinned: []
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should handle partial status groups', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should handle transform errors gracefully', async () => {
      const circularObj: any = {}
      circularObj.self = circularObj

      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'valid', name: 'Valid', url: 'https://v.com' },
              { id: 'bad', name: 'Bad', url: 'https://bad.com', circular: circularObj }
            ]
          }
        },
        dbh.db
      ) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('execute', () => {
    it('should return success with 0 when no prepared rows', async () => {
      const ctx = createTestContext({}, dbh.db) as any
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should batch insert rows into real DB', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: Array.from({ length: 150 }, (_, i) => ({
              id: `app${i}`,
              name: `App ${i}`,
              url: `https://app${i}.com`
            }))
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(150)

      // Verify rows are actually in the database
      const rows = await dbh.db.select().from(miniAppTable)
      expect(rows).toHaveLength(150)
    })

    it('should re-index sortOrder within each status group after dedup', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'app1', name: 'App 1', url: 'https://1.com' },
              { id: 'app2', name: 'App 2', url: 'https://2.com' },
              { id: 'app3', name: 'App 3', url: 'https://3.com' }
            ]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      // Verify orderKey is correctly stamped (ascending) within the status partition
      const rows = await dbh.db.select().from(miniAppTable).orderBy(miniAppTable.orderKey)
      expect(rows).toHaveLength(3)
      expect(rows[0].orderKey).toBeTruthy()
      expect(rows[0].orderKey < rows[1].orderKey).toBe(true)
      expect(rows[1].orderKey < rows[2].orderKey).toBe(true)
    })

    it('should set pinned status for pinned apps (dedup priority)', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com', type: 'Default' }],
            pinned: [{ id: 'app1', name: 'Pinned App', url: 'https://1.com', type: 'Default' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app1'))
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pinned')
    })

    it('should handle execute errors from real DB', async () => {
      // Create a context that will cause a constraint violation
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)

      // Insert a duplicate row to trigger a UNIQUE constraint violation
      await dbh.db.insert(miniAppTable).values({
        appId: 'app1',
        presetMiniappId: null,
        name: 'Existing',
        url: 'https://existing.com',
        status: 'enabled',
        orderKey: 'a0'
      })

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.processedCount).toBe(0)
    })
  })

  describe('validate', () => {
    it('should validate successfully when counts match', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'app1', name: 'App 1', url: 'https://1.com' },
              { id: 'app2', name: 'App 2', url: 'https://2.com' }
            ]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stats).toEqual({
        sourceCount: 2,
        targetCount: 2,
        skippedCount: 0
      })
    })

    it('should report errors when counts mismatch', async () => {
      // Prepare 1 app but don't execute (so DB has 0 rows)
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors?.length).toBeGreaterThan(0)
      expect(result.errors?.some((e) => e.key === 'count_mismatch')).toBe(true)
    })

    it('should include skipped count in stats', async () => {
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'app1', name: 'App 1', url: 'https://1.com' },
              { name: 'No ID', url: 'https://x.com' }
            ]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const result = await migrator.validate(ctx)

      expect(result.stats?.skippedCount).toBe(1)
    })

    it('should count cross-group duplicates as skipped so engine invariant holds', async () => {
      // v1 stores pinned apps in BOTH `pinned` and `enabled`. The migrator dedups
      // by app id, but those duplicates must be reported as skipped — otherwise
      // MigrationEngine.validateMigratorResult fails the
      // `targetCount >= sourceCount - skippedCount` invariant.
      const ctx = createTestContext(
        {
          minapps: {
            enabled: [
              { id: 'app1', name: 'A1', url: 'https://1.com' },
              { id: 'app2', name: 'A2', url: 'https://2.com' },
              { id: 'app3', name: 'A3 (also pinned)', url: 'https://3.com' }
            ],
            pinned: [{ id: 'app3', name: 'A3 pinned', url: 'https://3.com' }]
          }
        },
        dbh.db
      ) as any

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(true)
      // 4 raw entries (3 enabled + 1 pinned) → 3 unique rows, 1 dedup'd
      expect(result.stats?.sourceCount).toBe(4)
      expect(result.stats?.targetCount).toBe(3)
      expect(result.stats?.skippedCount).toBe(1)
      // engine invariant
      expect(result.stats!.targetCount).toBe(result.stats!.sourceCount - result.stats!.skippedCount)
    })
  })

  describe('migrator metadata', () => {
    it('should have correct id', () => {
      expect(migrator.id).toBe('miniapp')
    })

    it('should have correct name', () => {
      expect(migrator.name).toBe('MiniApp')
    })

    it('should have correct description', () => {
      expect(migrator.description).toContain('Redux')
      expect(migrator.description).toContain('SQLite')
    })

    it('should have correct order', () => {
      expect(migrator.order).toBe(1.2)
    })
  })
})
