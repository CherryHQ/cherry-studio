import { application } from '@application'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api/errors'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, type Mock } from 'vitest'

describe('MiniAppService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    // Each test gets a fresh DB. better-sqlite3 is synchronous, so route
    // withWriteTx through the real transaction: constraint violations then throw
    // synchronously and reach withSqliteErrors. The default async mock would
    // swallow such a throw into a rejected promise that withSqliteErrors'
    // synchronous try/catch never sees.
    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockImplementation((fn: (tx: unknown) => unknown) => dbh.db.transaction(fn as never))
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
      await seedCustom({ background: '#ffffff', supportedRegions: ['CN'] })
      const result = miniAppService.getByAppId('custom-app')
      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.presetMiniAppId).toBeNull()
      expect(result.bordered).toBeUndefined()
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
    })

    it('should return a preset-derived miniapp with presetMiniAppId set', async () => {
      await seedPreset('openai')
      const result = miniAppService.getByAppId('openai')
      expect(result.appId).toBe('openai')
      expect(result.presetMiniAppId).toBe('openai')
      expect(result.bordered).toBe(true)
      expect(result.supportedRegions).toEqual(['CN', 'Global'])
    })

    it('should throw NOT_FOUND for nonexistent appId', async () => {
      let err: unknown
      try {
        miniAppService.getByAppId('nonexistent')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return all rows', async () => {
      await seedCustom()
      await seedPreset('openai')

      const result = miniAppService.list({})

      expect(result).toHaveLength(2)
    })

    it('should filter by status', async () => {
      await seedCustom({ status: 'disabled' })
      await seedPreset('openai', { status: 'enabled' })

      const result = miniAppService.list({ status: 'disabled' })

      expect(result.every((m) => m.status === 'disabled')).toBe(true)
    })
  })

  describe('create', () => {
    it('should create a custom miniapp', async () => {
      const dto: CreateMiniAppDto = {
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: 'custom-logo'
      }

      const result = miniAppService.create(dto)

      expect(result.appId).toBe('new-app')
      expect(result.presetMiniAppId).toBeNull()
      expect(result.bordered).toBeUndefined()
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
      expect(result.configuration).toBeUndefined()

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'new-app'))
      expect(row.presetMiniAppId).toBeNull()
      expect(row.name).toBe('New App')
    })

    it('should place a new custom miniapp at the tail of the visible list', async () => {
      await seedCustom({ appId: 'enabled-tail', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-tail', status: 'pinned', orderKey: 'a5' })

      const result = miniAppService.create({
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: 'custom-logo'
      })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a5').toBe(true)
    })

    it('should reject creation if appId is a preset id', async () => {
      let err: unknown
      try {
        miniAppService.create({
          appId: 'openai',
          name: 'fake',
          url: 'https://fake.app',
          logo: 'fake'
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.CONFLICT, status: 409 })
    })

    it('should reject duplicate custom appId', async () => {
      await seedCustom()
      let err: unknown
      try {
        miniAppService.create({
          appId: 'custom-app',
          name: 'dup',
          url: 'https://dup.app',
          logo: 'dup'
        })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.CONFLICT })
    })
  })

  describe('update', () => {
    it('should update status on a custom miniapp', async () => {
      await seedCustom()
      const dto: UpdateMiniAppDto = { status: 'disabled' }

      const result = miniAppService.update('custom-app', dto)

      expect(result.status).toBe('disabled')
    })

    it('should update user-facing fields on a custom miniapp', async () => {
      await seedCustom({ background: '#ffffff', supportedRegions: ['CN'] })

      const result = miniAppService.update('custom-app', {
        name: 'Renamed App',
        url: 'https://renamed.app',
        logo: 'data:image/png;base64,avatar'
      })

      expect(result).toMatchObject({
        name: 'Renamed App',
        url: 'https://renamed.app',
        logo: 'data:image/png;base64,avatar'
      })
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
    })

    it('should update status on a preset miniapp', async () => {
      await seedPreset('openai')

      const result = miniAppService.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')
    })

    it('should reject display field updates on a preset miniapp', async () => {
      await seedPreset('openai')

      let err: unknown
      try {
        miniAppService.update('openai', { name: 'Renamed Preset' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('should reject empty update', async () => {
      await seedCustom()
      let err: unknown
      try {
        miniAppService.update('custom-app', {})
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw NOT_FOUND when updating a nonexistent appId', async () => {
      let err: unknown
      try {
        miniAppService.update('nonexistent', { status: 'disabled' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should place the row at the tail when moving into the disabled partition (#3198809973)', async () => {
      await seedCustom({ appId: 'disabled-A', status: 'disabled', orderKey: 'a0' })
      await seedCustom({ appId: 'disabled-B', status: 'disabled', orderKey: 'a1' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a0' })

      const result = miniAppService.update('mover', { status: 'disabled' })

      expect(result.status).toBe('disabled')
      expect(result.orderKey > 'a1').toBe(true)
    })

    it('should preserve visible list placement when adding an enabled app to launchpad', async () => {
      await seedCustom({ appId: 'pinned-before', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-after', status: 'pinned', orderKey: 'a2' })

      const result = miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey > 'a0').toBe(true)
      expect(result.orderKey < 'a2').toBe(true)
    })

    it('should preserve visible list placement when visible neighbors are in another status', async () => {
      await seedCustom({ appId: 'pinned-start', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'enabled-before', status: 'enabled', orderKey: 'a2' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a5' })
      await seedCustom({ appId: 'enabled-after', status: 'enabled', orderKey: 'a6' })

      const result = miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey > 'a2').toBe(true)
      expect(result.orderKey < 'a6').toBe(true)
    })

    it('should avoid same-key collisions when adding an enabled app to launchpad', async () => {
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a0' })
      await seedCustom({ appId: 'already-pinned', status: 'pinned', orderKey: 'a0' })

      const result = miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey < 'a0').toBe(true)
    })

    it('should avoid same-key collisions when removing a pinned app from launchpad', async () => {
      await seedCustom({ appId: 'mover', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'already-enabled', status: 'enabled', orderKey: 'a0' })

      const result = miniAppService.update('mover', { status: 'enabled' })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a0').toBe(true)
    })

    it('should place a disabled app at the visible tail when re-enabled', async () => {
      await seedCustom({ appId: 'enabled-tail', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-tail', status: 'pinned', orderKey: 'a5' })
      await seedCustom({ appId: 'mover', status: 'disabled', orderKey: 'a0' })

      const result = miniAppService.update('mover', { status: 'enabled' })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a5').toBe(true)
    })

    it('should keep the existing orderKey when status is unchanged', async () => {
      await seedCustom({ appId: 'stay', status: 'enabled', orderKey: 'a5' })

      const result = miniAppService.update('stay', { status: 'enabled' })

      expect(result.orderKey).toBe('a5')
    })

    it('should keep the existing orderKey when a solo visible row changes status', async () => {
      await seedCustom({ appId: 'solo', status: 'enabled', orderKey: 'a5' })

      const result = miniAppService.update('solo', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey).toBe('a5')
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustom()
      const withWriteTx = application.get('DbService').withWriteTx as Mock
      withWriteTx.mockClear()

      miniAppService.delete('custom-app')

      expect(withWriteTx).toHaveBeenCalledTimes(1)
      const rows = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'custom-app'))
      expect(rows).toHaveLength(0)
    })

    it('should reject deletion of preset-derived rows', async () => {
      await seedPreset('openai')
      let err: unknown
      try {
        miniAppService.delete('openai')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('should throw NOT_FOUND for nonexistent appId', async () => {
      let err: unknown
      try {
        miniAppService.delete('nonexistent')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorder', () => {
    it('should reorder within a status partition via fractional indexing', async () => {
      await seedCustom({ appId: 'app-1', name: 'A1', orderKey: 'a0' })
      await seedCustom({ appId: 'app-2', name: 'A2', orderKey: 'b0' })

      miniAppService.reorder([{ id: 'app-2', anchor: { before: 'app-1' } }])

      const [row1] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-1'))
      const [row2] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'app-2'))
      expect(row2.orderKey < row1.orderKey).toBe(true)
    })

    it('should reorder across enabled and pinned rows in the visible scope', async () => {
      await seedCustom({ appId: 'pinned-1', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'enabled-1', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-2', status: 'pinned', orderKey: 'a2' })

      miniAppService.reorder([{ id: 'enabled-1', anchor: { after: 'pinned-2' } }])

      const [moved] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'enabled-1'))
      const [anchor] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'pinned-2'))
      expect(moved.orderKey > anchor.orderKey).toBe(true)
    })

    it('should throw NOT_FOUND for non-existent app IDs', async () => {
      let err: unknown
      try {
        miniAppService.reorder([{ id: 'nonexistent', anchor: { position: 'first' } }])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should be a no-op when called with an empty batch', async () => {
      await seedCustom({ appId: 'untouched', orderKey: 'a0' })

      expect(miniAppService.reorder([])).toBeUndefined()

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'untouched'))
      expect(row.orderKey).toBe('a0')
    })

    it('should reject visible/hidden batches with VALIDATION_ERROR (#3198896254)', async () => {
      await seedCustom({ appId: 'enabled-1', status: 'enabled', orderKey: 'a0' })
      await seedCustom({ appId: 'disabled-1', status: 'disabled', orderKey: 'a0' })

      let err: unknown
      try {
        miniAppService.reorder([
          { id: 'enabled-1', anchor: { position: 'first' } },
          { id: 'disabled-1', anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })
  })
})
