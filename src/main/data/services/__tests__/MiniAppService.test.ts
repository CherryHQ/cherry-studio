import { miniAppTable } from '@data/db/schemas/miniapp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

describe('MiniAppService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    // Each test gets a fresh DB.
  })

  /** Insert a custom row directly. */
  async function seedCustom(overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const values: typeof miniAppTable.$inferInsert = {
      appId: 'custom-app',
      presetMiniAppId: null,
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

  /** Insert a preset-derived row directly (full data). */
  async function seedPreset(appId: string, overrides: Partial<typeof miniAppTable.$inferInsert> = {}) {
    const preset = PRESETS_MINI_APPS.find((p) => p.id === appId)
    if (!preset) throw new Error(`Unknown preset: ${appId}`)
    const values: typeof miniAppTable.$inferInsert = {
      appId,
      presetMiniAppId: appId,
      name: preset.name,
      url: preset.url,
      logo: preset.logo ?? null,
      bordered: preset.bordered ?? true,
      background: preset.background ?? null,
      supportedRegions: preset.supportedRegions ?? null,
      nameKey: preset.nameKey ?? null,
      status: 'enabled',
      orderKey: 'a0',
      ...overrides
    }
    await dbh.db.insert(miniAppTable).values(values)
    return values
  }

  describe('getByAppId', () => {
    it('should return a custom miniapp', async () => {
      await seedCustom()
      const result = await miniAppService.getByAppId('custom-app')
      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.presetMiniAppId).toBeNull()
    })

    it('should return a preset-derived miniapp with presetMiniAppId set', async () => {
      await seedPreset('openai')
      const result = await miniAppService.getByAppId('openai')
      expect(result.appId).toBe('openai')
      expect(result.presetMiniAppId).toBe('openai')
    })

    it('should throw NOT_FOUND for nonexistent appId', async () => {
      await expect(miniAppService.getByAppId('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return all rows', async () => {
      await seedCustom()
      await seedPreset('openai')

      const result = await miniAppService.list({})

      expect(result).toHaveLength(2)
    })

    it('should filter by status', async () => {
      await seedCustom({ status: 'disabled' })
      await seedPreset('openai', { status: 'enabled' })

      const result = await miniAppService.list({ status: 'disabled' })

      expect(result.every((m) => m.status === 'disabled')).toBe(true)
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
      expect(result.presetMiniAppId).toBeNull()

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'new-app'))
      expect(row.presetMiniAppId).toBeNull()
      expect(row.name).toBe('New App')
    })

    it('should reject creation if appId is a preset id', async () => {
      await expect(
        miniAppService.create({
          appId: 'openai',
          name: 'fake',
          url: 'https://fake.app',
          logo: 'fake',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, status: 409 })
    })

    it('should reject duplicate custom appId', async () => {
      await seedCustom()
      await expect(
        miniAppService.create({
          appId: 'custom-app',
          name: 'dup',
          url: 'https://dup.app',
          logo: 'dup',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    })
  })

  describe('update', () => {
    it('should update status on a custom miniapp', async () => {
      await seedCustom()
      const dto: UpdateMiniAppDto = { status: 'disabled' }

      const result = await miniAppService.update('custom-app', dto)

      expect(result.status).toBe('disabled')
    })

    it('should update status on a preset miniapp', async () => {
      await seedPreset('openai')

      const result = await miniAppService.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')
    })

    it('should reject empty update', async () => {
      await seedCustom()
      await expect(miniAppService.update('custom-app', {})).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should place the row at the tail of the target partition on status change (#3198809973)', async () => {
      // Seed two enabled rows, plus the row we'll move from pinned → enabled.
      await seedCustom({ appId: 'enabled-A', status: 'enabled', orderKey: 'a0' })
      await seedCustom({ appId: 'enabled-B', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'mover', status: 'pinned', orderKey: 'a0' })

      const result = await miniAppService.update('mover', { status: 'enabled' })

      expect(result.status).toBe('enabled')
      // Tail of the enabled partition: greater than the previous largest key.
      expect(result.orderKey > 'a1').toBe(true)
    })

    it('should keep the existing orderKey when status is unchanged', async () => {
      await seedCustom({ appId: 'stay', status: 'enabled', orderKey: 'a5' })

      const result = await miniAppService.update('stay', { status: 'enabled' })

      expect(result.orderKey).toBe('a5')
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustom()
      await miniAppService.delete('custom-app')
      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(rows).toHaveLength(0)
    })

    it('should reject deletion of preset-derived rows', async () => {
      await seedPreset('openai')
      await expect(miniAppService.delete('openai')).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('should throw NOT_FOUND for nonexistent appId', async () => {
      await expect(miniAppService.delete('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorder', () => {
    it('should reorder within a status partition via fractional indexing', async () => {
      await seedCustom({ appId: 'app-1', name: 'A1', orderKey: 'a0' })
      await seedCustom({ appId: 'app-2', name: 'A2', orderKey: 'b0' })

      await miniAppService.reorder([{ id: 'app-2', anchor: { before: 'app-1' } }])

      const [row1] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-1'))
      const [row2] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-2'))
      expect(row2.orderKey < row1.orderKey).toBe(true)
    })

    it('should throw NOT_FOUND for non-existent app IDs', async () => {
      await expect(
        miniAppService.reorder([{ id: 'nonexistent', anchor: { position: 'first' } }])
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should reject cross-status batches with VALIDATION_ERROR (#3198896254)', async () => {
      // mini_app.status is the reorder scope: a single batch must stay inside
      // one status partition. Mixing enabled + disabled in a single batch
      // violates the DataApi scoped-reorder contract.
      await seedCustom({ appId: 'enabled-1', status: 'enabled', orderKey: 'a0' })
      await seedCustom({ appId: 'disabled-1', status: 'disabled', orderKey: 'a0' })

      await expect(
        miniAppService.reorder([
          { id: 'enabled-1', anchor: { position: 'first' } },
          { id: 'disabled-1', anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })
  })
})
