import { miniAppTable } from '@data/db/schemas/miniapp'
import { miniAppRegistryService } from '@data/services/MiniAppRegistryService'
import { ErrorCode } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('MiniAppRegistryService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    // Each test gets a fresh DB; nothing else to reset.
  })

  /** Insert a custom (full-data) row directly. */
  async function seedCustomRow(overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId: 'custom-app',
      presetMiniappId: null,
      name: 'Custom App',
      url: 'https://custom.app',
      logo: 'application',
      status: 'enabled',
      orderKey: 'a0',
      bordered: false,
      ...overrides
    }
    await dbh.db.insert(miniAppTable).values(values)
    return values
  }

  /** Insert a preset-override row (delta only). */
  async function seedOverrideRow(appId: string, overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId,
      presetMiniappId: appId,
      status: 'enabled',
      orderKey: 'a0',
      ...overrides
    }
    await dbh.db.insert(miniAppTable).values(values)
    return values
  }

  describe('getByAppId', () => {
    it('should merge preset with override row for a default app', async () => {
      await seedOverrideRow('openai', { status: 'disabled', orderKey: 'z9' })

      const result = await miniAppRegistryService.getByAppId('openai')

      expect(result.appId).toBe('openai')
      expect(result.name).toBe('ChatGPT')
      expect(result.url).toBe('https://chatgpt.com/')
      expect(result.status).toBe('disabled')
      expect(result.orderKey).toBe('z9')
      expect(result.kind).toBe('default')
    })

    it('should return preset with default status when no override exists', async () => {
      const result = await miniAppRegistryService.getByAppId('gemini')

      expect(result.appId).toBe('gemini')
      expect(result.name).toBe('Gemini')
      expect(result.status).toBe('enabled')
      expect(result.kind).toBe('default')
    })

    it('should return a custom miniapp from DB', async () => {
      await seedCustomRow()

      const result = await miniAppRegistryService.getByAppId('custom-app')

      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.kind).toBe('custom')
    })

    it('should throw NOT_FOUND for nonexistent custom app', async () => {
      await expect(miniAppRegistryService.getByAppId('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return merged builtin and custom apps', async () => {
      await seedCustomRow()

      const result = await miniAppRegistryService.list({})

      expect(result.length).toBeGreaterThan(PRESETS_MINI_APPS.length)
    })

    it('should filter by kind=custom', async () => {
      await seedCustomRow()

      const result = await miniAppRegistryService.list({ kind: 'custom' })

      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('custom')
      expect(result[0].appId).toBe('custom-app')
    })

    it('should filter by kind=default', async () => {
      const result = await miniAppRegistryService.list({ kind: 'default' })

      expect(result.length).toBe(PRESETS_MINI_APPS.length)
      expect(result.every((item) => item.kind === 'default')).toBe(true)
    })

    it('should filter by status', async () => {
      await seedOverrideRow('openai', { status: 'disabled' })

      const result = await miniAppRegistryService.list({ status: 'disabled' })

      expect(result.every((item) => item.status === 'disabled')).toBe(true)
    })

    it('should sort items by status priority then orderKey', async () => {
      await seedCustomRow({ appId: 'a', name: 'A', orderKey: 'a2' })
      await seedOverrideRow('openai', { status: 'pinned', orderKey: 'a5' })

      const result = await miniAppRegistryService.list({})

      const pinnedIndex = result.findIndex((item) => item.status === 'pinned')
      const enabledIndex = result.findIndex((item) => item.status === 'enabled')
      expect(pinnedIndex).toBeLessThan(enabledIndex)
    })
  })

  describe('createCustom', () => {
    it('should create a custom miniapp', async () => {
      const dto: CreateMiniAppDto = {
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: 'custom-logo',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      }

      const result = await miniAppRegistryService.createCustom(dto)

      expect(result.appId).toBe('new-app')
      expect(result.name).toBe('New App')
      expect(result.kind).toBe('custom')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'new-app'))
      expect(row.name).toBe('New App')
      expect(row.status).toBe('enabled')
    })

    it('should reject creation if appId is a preset app', async () => {
      await expect(
        miniAppRegistryService.createCustom({
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
      await seedCustomRow()

      await expect(
        miniAppRegistryService.createCustom({
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
      await seedCustomRow()

      const dto: UpdateMiniAppDto = {
        name: 'Updated App',
        url: 'https://updated.app',
        status: 'disabled'
      }

      const result = await miniAppRegistryService.update('custom-app', dto)

      expect(result.name).toBe('Updated App')
      expect(result.url).toBe('https://updated.app')
      expect(result.status).toBe('disabled')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(row.name).toBe('Updated App')
      expect(row.status).toBe('disabled')
    })

    it('should only allow status for preset apps; row stores delta only', async () => {
      const result = await miniAppRegistryService.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.kind).toBe('default')

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row.status).toBe('pinned')
      expect(row.name).toBeNull()
      expect(row.url).toBeNull()
    })

    it('should reject non-status field updates for preset apps', async () => {
      await expect(miniAppRegistryService.update('openai', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })
    })

    it('should reject empty update for preset apps', async () => {
      await expect(miniAppRegistryService.update('openai', {})).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustomRow()

      await miniAppRegistryService.delete('custom-app')

      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(rows).toHaveLength(0)
    })

    it('should reject deletion of preset apps', async () => {
      await expect(miniAppRegistryService.delete('openai')).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })
  })

  describe('reorder', () => {
    it('should swap orderKey via fractional-indexing within a status partition', async () => {
      await seedCustomRow({ appId: 'app-1', name: 'A1', orderKey: 'a0' })
      await seedCustomRow({ appId: 'app-2', name: 'A2', orderKey: 'b0' })

      await miniAppRegistryService.reorder([{ id: 'app-2', anchor: { before: 'app-1' } }])

      const [row1] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-1'))
      const [row2] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-2'))
      expect(row2.orderKey < row1.orderKey).toBe(true)
    })

    it('should seed an override row for a preset app on first reorder', async () => {
      await miniAppRegistryService.reorder([{ id: 'openai', anchor: { position: 'first' } }])

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'openai'))
      expect(row).toBeDefined()
      expect(row.orderKey).toBeTruthy()
      // Override row — preset fields stay NULL.
      expect(row.name).toBeNull()
      expect(row.url).toBeNull()
    })
  })
})
