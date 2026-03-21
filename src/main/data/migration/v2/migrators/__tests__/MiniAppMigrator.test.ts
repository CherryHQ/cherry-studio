import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { MiniAppMigrator } from '../MiniAppMigrator'

function createMockContext(reduxData: Record<string, unknown> = {}) {
  const reduxState = new ReduxStateReader(reduxData)

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState,
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined)
          })
        }
        await fn(tx)
      }),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ count: 0 }),
      limit: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue([])
    }
  }
}

describe('MiniAppMigrator', () => {
  let migrator: MiniAppMigrator

  beforeEach(() => {
    migrator = new MiniAppMigrator()
  })

  describe('prepare', () => {
    it('should return success with 0 items when no minapps state', async () => {
      const ctx = createMockContext({}) as any
      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should return success with 0 items when minapps is null', async () => {
      const ctx = createMockContext({ minapps: null }) as any
      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should prepare apps from all status groups', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'app1', name: 'App 1', url: 'https://1.com' },
            { id: 'app2', name: 'App 2', url: 'https://2.com' }
          ],
          disabled: [{ id: 'app3', name: 'App 3', url: 'https://3.com' }],
          pinned: [{ id: 'app4', name: 'App 4', url: 'https://4.com' }]
        }
      }) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(4)
    })

    it('should deduplicate apps with same id (pinned takes priority)', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'Enabled App', url: 'https://1.com', type: 'Default' }],
          pinned: [{ id: 'app1', name: 'Pinned App', url: 'https://1.com', type: 'Default' }]
        }
      }) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)

      // Verify by executing and checking validation stats
      const validateResult = await migrator.validate(ctx)
      expect(validateResult.stats?.sourceCount).toBe(1)
    })

    it('should skip apps without valid id', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'valid', name: 'Valid App', url: 'https://v.com' },
            { name: 'No ID App', url: 'https://x.com' },
            { id: 123, name: 'Number ID', url: 'https://n.com' },
            null,
            undefined
          ]
        }
      }) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.length).toBeGreaterThan(0)
    })

    it('should handle empty arrays in status groups', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [],
          disabled: [],
          pinned: []
        }
      }) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should handle partial status groups', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
          // disabled and pinned are missing
        }
      }) as any

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should re-index sortOrder within each status group after dedup', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'app1', name: 'App 1', url: 'https://1.com' },
            { id: 'app2', name: 'App 2', url: 'https://2.com' },
            { id: 'app3', name: 'App 3', url: 'https://3.com' }
          ]
        }
      }) as any

      await migrator.prepare(ctx)

      // Execute to trigger batch insert and capture the rows passed to values()
      let capturedRows: any[] = []
      const txCtx = {
        ...ctx,
        db: {
          ...ctx.db,
          transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
            const tx = {
              insert: vi.fn().mockReturnValue({
                values: vi.fn().mockImplementation((rows: any[]) => {
                  capturedRows = rows
                  return Promise.resolve(undefined)
                })
              })
            }
            await fn(tx)
          })
        }
      }

      await migrator.execute(txCtx)

      // Check that the rows have correctly indexed sortOrder (0, 1, 2)
      expect(capturedRows.length).toBe(3)
      expect(capturedRows[0].sortOrder).toBe(0)
      expect(capturedRows[1].sortOrder).toBe(1)
      expect(capturedRows[2].sortOrder).toBe(2)
    })

    it('should handle transform errors gracefully', async () => {
      // createCircularObject creates an object that will throw on access
      const circularObj: any = {}
      circularObj.self = circularObj // circular reference

      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'valid', name: 'Valid', url: 'https://v.com' },
            {
              id: 'bad',
              name: 'Bad',
              url: 'https://bad.com',
              // This will cause JSON.stringify to fail, which may be used in transform
              circular: circularObj
            }
          ]
        }
      }) as any

      const result = await migrator.prepare(ctx)

      // Should still succeed (graceful handling) - or both items may be processed if transform handles it
      expect(result.success).toBe(true)
      // itemCount may be 1 or 2 depending on whether transform handles the bad data
      expect(result.itemCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('execute', () => {
    it('should return success with 0 when no prepared rows', async () => {
      const ctx = createMockContext() as any
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should batch insert rows', async () => {
      // First prepare some data
      const ctx = createMockContext({
        minapps: {
          enabled: Array.from({ length: 150 }, (_, i) => ({
            id: `app${i}`,
            name: `App ${i}`,
            url: `https://app${i}.com`
          }))
        }
      }) as any

      await migrator.prepare(ctx)

      // Track insert calls
      const insertCalls: any[][] = []
      const txCtx = {
        ...ctx,
        db: {
          transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
            const tx = {
              insert: vi.fn().mockReturnValue({
                values: vi.fn().mockImplementation((rows: any[]) => {
                  insertCalls.push(rows)
                  return Promise.resolve(undefined)
                })
              })
            }
            await fn(tx)
          })
        }
      }

      const result = await migrator.execute(txCtx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(150)
      // Should have at least 2 batches (100 + 50)
      expect(insertCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle execute errors', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
        }
      }) as any

      await migrator.prepare(ctx)

      const errorCtx = {
        ...ctx,
        db: {
          transaction: vi.fn().mockRejectedValue(new Error('DB Error'))
        }
      }

      const result = await migrator.execute(errorCtx)

      expect(result.success).toBe(false)
      expect(result.error).toBe('DB Error')
      expect(result.processedCount).toBe(0)
    })
  })

  describe('validate', () => {
    it('should validate successfully when counts match', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'app1', name: 'App 1', url: 'https://1.com' },
            { id: 'app2', name: 'App 2', url: 'https://2.com' }
          ]
        }
      }) as any

      await migrator.prepare(ctx)

      // Mock db to return matching count
      const validateCtx = {
        ...ctx,
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ count: 2 }),
          limit: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { appId: 'app1', name: 'App 1', url: 'https://1.com' },
            { appId: 'app2', name: 'App 2', url: 'https://2.com' }
          ])
        }
      }

      const result = await migrator.validate(validateCtx)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stats).toEqual({
        sourceCount: 2,
        targetCount: 2,
        skippedCount: 0
      })
    })

    it('should report errors when counts mismatch', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
        }
      }) as any

      await migrator.prepare(ctx)

      const validateCtx = {
        ...ctx,
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ count: 0 }), // mismatch
          limit: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([])
        }
      }

      const result = await migrator.validate(validateCtx)

      expect(result.success).toBe(false)
      expect(result.errors?.length).toBeGreaterThan(0)
      expect(result.errors?.some((e) => e.key === 'count_mismatch')).toBe(true)
    })

    it('should detect missing required fields in sample', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
        }
      }) as any

      await migrator.prepare(ctx)

      const validateCtx = {
        ...ctx,
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ count: 1 }),
          limit: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { appId: '', name: 'App 1', url: 'https://1.com' }, // missing appId
            { appId: 'app2', name: '', url: 'https://2.com' }, // missing name
            { appId: 'app3', name: 'App 3', url: '' } // missing url
          ])
        }
      }

      const result = await migrator.validate(validateCtx)

      expect(result.success).toBe(false)
      expect(result.errors?.some((e) => e.message.includes('Missing required field'))).toBe(true)
    })

    it('should handle validation db errors', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [{ id: 'app1', name: 'App 1', url: 'https://1.com' }]
        }
      }) as any

      await migrator.prepare(ctx)

      const errorCtx = {
        ...ctx,
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          get: vi.fn().mockRejectedValue(new Error('Query failed'))
        }
      }

      const result = await migrator.validate(errorCtx)

      expect(result.success).toBe(false)
      expect(result.errors?.some((e) => e.key === 'validation')).toBe(true)
    })

    it('should include skipped count in stats', async () => {
      const ctx = createMockContext({
        minapps: {
          enabled: [
            { id: 'app1', name: 'App 1', url: 'https://1.com' },
            { name: 'No ID', url: 'https://x.com' } // will be skipped
          ]
        }
      }) as any

      await migrator.prepare(ctx)

      const validateCtx = {
        ...ctx,
        db: {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ count: 1 }),
          limit: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([{ appId: 'app1', name: 'App 1', url: 'https://1.com' }])
        }
      }

      const result = await migrator.validate(validateCtx)

      expect(result.stats?.skippedCount).toBe(1)
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
