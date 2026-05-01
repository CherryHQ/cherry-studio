import { miniAppTable } from '@data/db/schemas/miniapp'
import { MiniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniapps'
import { ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('MiniAppService', () => {
  const dbh = setupTestDatabase()
  let service: MiniAppService

  beforeEach(() => {
    service = new MiniAppService()
  })

  async function seedCustomApp(overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId: 'custom-app',
      name: 'Custom App',
      url: 'https://custom.app',
      logo: 'application',
      type: 'custom',
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
      type: 'default',
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

      const result = await service.getByAppId('openai')

      expect(result.appId).toBe('openai')
      expect(result.name).toBe('ChatGPT')
      expect(result.url).toBe('https://chatgpt.com/')
      expect(result.status).toBe('disabled')
      expect(result.sortOrder).toBe(10)
      expect(result.type).toBe('default')
    })

    it('should return builtin with defaults when no DB row exists', async () => {
      const result = await service.getByAppId('gemini')

      expect(result.appId).toBe('gemini')
      expect(result.name).toBe('Gemini')
      expect(result.status).toBe('enabled')
      expect(result.type).toBe('default')
    })

    it('should return a custom miniapp from DB', async () => {
      await seedCustomApp()

      const result = await service.getByAppId('custom-app')

      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.type).toBe('custom')
    })

    it('should throw NotFound for nonexistent custom app', async () => {
      await expect(service.getByAppId('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return merged builtin and custom apps', async () => {
      await seedCustomApp()

      const result = await service.list({})

      // Should include all builtin apps + the one custom app
      expect(result.items.length).toBeGreaterThan(ORIGIN_DEFAULT_MIN_APPS.length)
      expect(result.total).toBe(result.items.length)
      expect(result.page).toBe(1)
    })

    it('should filter by type=custom', async () => {
      await seedCustomApp()

      const result = await service.list({ type: 'custom' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].type).toBe('custom')
      expect(result.items[0].appId).toBe('custom-app')
    })

    it('should filter by type=default', async () => {
      const result = await service.list({ type: 'default' })

      expect(result.items.length).toBe(ORIGIN_DEFAULT_MIN_APPS.length)
      expect(result.items.every((item) => item.type === 'default')).toBe(true)
    })

    it('should filter by status', async () => {
      await seedDefaultAppPref('openai', { status: 'disabled' })

      const result = await service.list({ status: 'disabled' })

      expect(result.items.every((item) => item.status === 'disabled')).toBe(true)
    })

    it('should sort items by status priority then sortOrder', async () => {
      await seedCustomApp({ appId: 'a', name: 'A', sortOrder: 2 })
      await seedDefaultAppPref('openai', { status: 'pinned', sortOrder: 5 })

      const result = await service.list({})

      const pinnedIndex = result.items.findIndex((item) => item.status === 'pinned')
      const enabledIndex = result.items.findIndex((item) => item.status === 'enabled')
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

      const result = await service.create(dto)

      expect(result.appId).toBe('new-app')
      expect(result.name).toBe('New App')
      expect(result.type).toBe('custom')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'new-app'))
      expect(row.name).toBe('New App')
      expect(row.status).toBe('enabled')
    })

    it('should reject creation if appId is a builtin app', async () => {
      await expect(
        service.create({
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
        service.create({
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
  })

  describe('update', () => {
    it('should update all fields for a custom miniapp', async () => {
      await seedCustomApp()

      const dto: UpdateMiniAppDto = {
        name: 'Updated App',
        url: 'https://updated.app',
        status: 'disabled'
      }

      const result = await service.update('custom-app', dto)

      expect(result.name).toBe('Updated App')
      expect(result.url).toBe('https://updated.app')
      expect(result.status).toBe('disabled')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(row.name).toBe('Updated App')
      expect(row.status).toBe('disabled')
    })

    it('should only allow preference fields for default apps', async () => {
      const result = await service.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')

      // A default-app pref row should have been upserted
      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row.status).toBe('pinned')
      expect(row.type).toBe('default')
    })

    it('should reject non-preference field updates for default apps', async () => {
      await expect(service.update('openai', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })
    })

    it('should reject update of nonexistent app', async () => {
      await expect(service.update('nonexistent', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustomApp()

      await expect(service.delete('custom-app')).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(rows).toHaveLength(0)
    })

    it('should reject deletion of default apps', async () => {
      await seedDefaultAppPref('openai')

      await expect(service.delete('openai')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })

      // Row should remain
      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(rows).toHaveLength(1)
    })
  })

  describe('reorder', () => {
    it('should batch update sort orders in a transaction', async () => {
      await seedCustomApp({ appId: 'app-1', name: 'A1', sortOrder: 5 })
      await seedCustomApp({ appId: 'app-2', name: 'A2', sortOrder: 7 })

      await service.reorder([
        { appId: 'app-1', sortOrder: 0 },
        { appId: 'app-2', sortOrder: 1 }
      ])

      const [row1] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-1'))
      const [row2] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-2'))
      expect(row1.sortOrder).toBe(0)
      expect(row2.sortOrder).toBe(1)
    })

    it('should ensure DB rows exist for builtin apps during reorder', async () => {
      await service.reorder([{ appId: 'openai', sortOrder: 3 }])

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row).toBeDefined()
      expect(row.sortOrder).toBe(3)
      expect(row.type).toBe('default')
    })

    it('should not throw for non-existent app IDs', async () => {
      await expect(service.reorder([{ appId: 'nonexistent', sortOrder: 0 }])).resolves.toBeUndefined()
    })
  })

  describe('resetDefaults', () => {
    it('should delete all default app preference rows but preserve custom ones', async () => {
      await seedCustomApp()
      await seedDefaultAppPref('openai')
      await seedDefaultAppPref('gemini', { status: 'pinned' })

      await service.resetDefaults()

      const rows = await dbh.db.select().from(miniAppTable)
      expect(rows.some((r) => r.type === 'default')).toBe(false)
      expect(rows.some((r) => r.appId === 'custom-app')).toBe(true)
    })
  })
})
