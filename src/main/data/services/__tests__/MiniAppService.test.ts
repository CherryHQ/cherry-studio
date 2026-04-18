import { miniAppTable } from '@data/db/schemas/miniapp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { ORIGIN_DEFAULT_MINI_APPS } from '@shared/data/presets/mini-apps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('MiniAppService', () => {
  const dbh = setupTestDatabase()

  async function seedCustomApp(overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId: 'custom-app',
      name: 'Custom App',
      url: 'https://custom.app',
      logo: 'application',
      kind: 'custom',
      status: 'enabled',
      sortOrder: 0,
      bordered: false,
      ...overrides
    }
    await dbh.db.insert(miniAppTable).values(values)
    return values
  }

  async function seedDefaultAppPref(appId: string, overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId,
      name: 'PlaceholderName',
      url: 'https://placeholder.test',
      kind: 'default',
      status: 'enabled',
      sortOrder: 0,
      ...overrides
    }
    await dbh.db.insert(miniAppTable).values(values)
    return values
  }

  describe('getByAppId', () => {
    it('should return a builtin miniapp merged with DB preferences', async () => {
      await seedDefaultAppPref('openai', { status: 'disabled', sortOrder: 10 })

      const result = await miniAppService.getByAppId('openai')

      expect(result.appId).toBe('openai')
      expect(result.name).toBe('ChatGPT')
      expect(result.url).toBe('https://chatgpt.com/')
      expect(result.status).toBe('disabled')
      expect(result.sortOrder).toBe(10)
      expect(result.kind).toBe('default')
    })

    it('should return builtin with defaults when no DB row exists', async () => {
      const result = await miniAppService.getByAppId('gemini')

      expect(result.appId).toBe('gemini')
      expect(result.name).toBe('Gemini')
      expect(result.status).toBe('enabled')
      expect(result.kind).toBe('default')
    })

    it('should return a custom miniapp from DB', async () => {
      await seedCustomApp()

      const result = await miniAppService.getByAppId('custom-app')

      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.kind).toBe('custom')
    })

    it('should throw NotFound for nonexistent custom app', async () => {
      await expect(miniAppService.getByAppId('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return merged builtin and custom apps', async () => {
      await seedCustomApp()

      const result = await miniAppService.list({})

      expect(result.length).toBeGreaterThan(ORIGIN_DEFAULT_MINI_APPS.length)
    })

    it('should filter by type=custom', async () => {
      await seedCustomApp()

      const result = await miniAppService.list({ type: 'custom' })

      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('custom')
      expect(result[0].appId).toBe('custom-app')
    })

    it('should filter by type=default', async () => {
      const result = await miniAppService.list({ type: 'default' })

      expect(result.length).toBe(ORIGIN_DEFAULT_MINI_APPS.length)
      expect(result.every((item) => item.kind === 'default')).toBe(true)
    })

    it('should filter by status', async () => {
      await seedDefaultAppPref('openai', { status: 'disabled' })

      const result = await miniAppService.list({ status: 'disabled' })

      expect(result.every((item) => item.status === 'disabled')).toBe(true)
    })

    it('should sort items by status priority then sortOrder', async () => {
      await seedCustomApp({ appId: 'a', name: 'A', sortOrder: 2 })
      await seedDefaultAppPref('openai', { status: 'pinned', sortOrder: 5 })

      const result = await miniAppService.list({})

      const pinnedIndex = result.findIndex((item) => item.status === 'pinned')
      const enabledIndex = result.findIndex((item) => item.status === 'enabled')
      expect(pinnedIndex).toBeLessThan(enabledIndex)
    })
  })

  describe('create', () => {
    it('should create a custom miniapp', async () => {
      const dto: CreateMiniAppDto = {
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: 'custom-logo',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      }

      const result = await miniAppService.create(dto)

      expect(result.appId).toBe('new-app')
      expect(result.name).toBe('New App')
      expect(result.kind).toBe('custom')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'new-app'))
      expect(row.name).toBe('New App')
      expect(row.status).toBe('enabled')
      expect(row.sortOrder).toBe(ORIGIN_DEFAULT_MINI_APPS.length)
    })

    it('should reject creation if appId is a builtin app', async () => {
      await expect(
        miniAppService.create({
          appId: 'openai',
          name: 'test',
          url: 'https://test.app',
          logo: 'test',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        status: 409
      })
    })

    it('should reject creation if appId already exists in DB', async () => {
      await seedCustomApp()

      await expect(
        miniAppService.create({
          appId: 'custom-app',
          name: 'Duplicate',
          url: 'https://dup.app',
          logo: 'duplicate',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        status: 409
      })
    })

    it('should assign the next sort order after existing custom apps', async () => {
      await seedCustomApp({ appId: 'app-a', name: 'A', sortOrder: 100 })
      await seedCustomApp({ appId: 'app-b', name: 'B', sortOrder: 7 })

      const result = await miniAppService.create({
        appId: 'ordered-app',
        name: 'Ordered App',
        url: 'https://ordered.app',
        logo: 'ordered-logo',
        bordered: false,
        supportedRegions: ['CN']
      })

      expect(result.sortOrder).toBe(101)

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'ordered-app'))
      expect(row.sortOrder).toBe(101)
    })
  })

  describe('update', () => {
    it('should update all fields for a custom miniapp', async () => {
      await seedCustomApp()

      const dto: UpdateMiniAppDto = {
        name: 'Updated App',
        url: 'https://updated.app',
        status: 'disabled'
      }

      const result = await miniAppService.update('custom-app', dto)

      expect(result.name).toBe('Updated App')
      expect(result.url).toBe('https://updated.app')
      expect(result.status).toBe('disabled')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(row.name).toBe('Updated App')
      expect(row.status).toBe('disabled')
    })

    it('should only allow preference fields for default apps', async () => {
      const result = await miniAppService.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row.status).toBe('pinned')
      expect(row.kind).toBe('default')
    })

    it('should reject non-preference field updates for default apps', async () => {
      await expect(miniAppService.update('openai', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })
    })

    it('should reject update of nonexistent app', async () => {
      await expect(miniAppService.update('nonexistent', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustomApp()

      await expect(miniAppService.delete('custom-app')).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(rows).toHaveLength(0)
    })

    it('should reject deletion of default apps', async () => {
      await seedDefaultAppPref('openai')

      await expect(miniAppService.delete('openai')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(rows).toHaveLength(1)
    })
  })

  describe('reorder', () => {
    it('should batch update sort orders in a transaction', async () => {
      await seedCustomApp({ appId: 'app-1', name: 'A1', sortOrder: 5 })
      await seedCustomApp({ appId: 'app-2', name: 'A2', sortOrder: 7 })

      await miniAppService.reorder([
        { appId: 'app-1', sortOrder: 0 },
        { appId: 'app-2', sortOrder: 1 }
      ])

      const [row1] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-1'))
      const [row2] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-2'))
      expect(row1.sortOrder).toBe(0)
      expect(row2.sortOrder).toBe(1)
    })

    it('should ensure DB rows exist for builtin apps during reorder', async () => {
      await miniAppService.reorder([{ appId: 'openai', sortOrder: 3 }])

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row).toBeDefined()
      expect(row.sortOrder).toBe(3)
      expect(row.kind).toBe('default')
    })

    it('should not throw for non-existent app IDs', async () => {
      const result = await miniAppService.reorder([{ appId: 'nonexistent', sortOrder: 999 }])
      expect(result).toEqual({ skipped: ['nonexistent'] })
    })
  })

  describe('resetDefaults', () => {
    it('should delete all default app preference rows but preserve custom ones', async () => {
      await seedCustomApp()
      await seedDefaultAppPref('openai')
      await seedDefaultAppPref('gemini', { status: 'pinned' })

      await miniAppService.resetDefaults()

      const rows = await dbh.db.select().from(miniAppTable)
      expect(rows.some((r) => r.kind === 'default')).toBe(false)
      expect(rows.some((r) => r.appId === 'custom-app')).toBe(true)
    })
  })
})
