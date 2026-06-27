import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, type Mock } from 'vitest'

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
      logoKey: 'application',
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
      logoKey: preset.logo ?? null,
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
      const result = await miniAppService.getByAppId('custom-app')
      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.presetMiniAppId).toBeNull()
      expect(result.bordered).toBeUndefined()
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
    })

    it('should return a preset-derived miniapp with presetMiniAppId set', async () => {
      await seedPreset('openai')
      const result = await miniAppService.getByAppId('openai')
      expect(result.appId).toBe('openai')
      expect(result.presetMiniAppId).toBe('openai')
      expect(result.bordered).toBe(true)
      expect(result.supportedRegions).toEqual(['CN', 'Global'])
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
        logo: { kind: 'key', key: 'custom-logo' }
      }

      const result = await miniAppService.create(dto)

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

      const result = await miniAppService.create({
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: { kind: 'key', key: 'custom-logo' }
      })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a5').toBe(true)
    })

    it('should reject creation if appId is a preset id', async () => {
      await expect(
        miniAppService.create({
          appId: 'openai',
          name: 'fake',
          url: 'https://fake.app',
          logo: { kind: 'key', key: 'fake' }
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
          logo: { kind: 'key', key: 'dup' }
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

    it('should update user-facing fields on a custom miniapp', async () => {
      await seedCustom({ background: '#ffffff', supportedRegions: ['CN'] })

      const result = await miniAppService.update('custom-app', {
        name: 'Renamed App',
        url: 'https://renamed.app',
        logo: { kind: 'key', key: 'icon:renamed' }
      })

      expect(result).toMatchObject({
        name: 'Renamed App',
        url: 'https://renamed.app',
        logo: 'icon:renamed'
      })
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
    })

    it('should update status on a preset miniapp', async () => {
      await seedPreset('openai')

      const result = await miniAppService.update('openai', { status: 'pinned' })

      expect(result.status).toBe('pinned')
    })

    it('should reject display field updates on a preset miniapp', async () => {
      await seedPreset('openai')

      await expect(miniAppService.update('openai', { name: 'Renamed Preset' })).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('should reject empty update', async () => {
      await seedCustom()
      await expect(miniAppService.update('custom-app', {})).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw NOT_FOUND when updating a nonexistent appId', async () => {
      await expect(miniAppService.update('nonexistent', { status: 'disabled' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should place the row at the tail when moving into the disabled partition (#3198809973)', async () => {
      await seedCustom({ appId: 'disabled-A', status: 'disabled', orderKey: 'a0' })
      await seedCustom({ appId: 'disabled-B', status: 'disabled', orderKey: 'a1' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a0' })

      const result = await miniAppService.update('mover', { status: 'disabled' })

      expect(result.status).toBe('disabled')
      expect(result.orderKey > 'a1').toBe(true)
    })

    it('should preserve visible list placement when adding an enabled app to launchpad', async () => {
      await seedCustom({ appId: 'pinned-before', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-after', status: 'pinned', orderKey: 'a2' })

      const result = await miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey > 'a0').toBe(true)
      expect(result.orderKey < 'a2').toBe(true)
    })

    it('should preserve visible list placement when visible neighbors are in another status', async () => {
      await seedCustom({ appId: 'pinned-start', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'enabled-before', status: 'enabled', orderKey: 'a2' })
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a5' })
      await seedCustom({ appId: 'enabled-after', status: 'enabled', orderKey: 'a6' })

      const result = await miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey > 'a2').toBe(true)
      expect(result.orderKey < 'a6').toBe(true)
    })

    it('should avoid same-key collisions when adding an enabled app to launchpad', async () => {
      await seedCustom({ appId: 'mover', status: 'enabled', orderKey: 'a0' })
      await seedCustom({ appId: 'already-pinned', status: 'pinned', orderKey: 'a0' })

      const result = await miniAppService.update('mover', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey < 'a0').toBe(true)
    })

    it('should avoid same-key collisions when removing a pinned app from launchpad', async () => {
      await seedCustom({ appId: 'mover', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'already-enabled', status: 'enabled', orderKey: 'a0' })

      const result = await miniAppService.update('mover', { status: 'enabled' })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a0').toBe(true)
    })

    it('should place a disabled app at the visible tail when re-enabled', async () => {
      await seedCustom({ appId: 'enabled-tail', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-tail', status: 'pinned', orderKey: 'a5' })
      await seedCustom({ appId: 'mover', status: 'disabled', orderKey: 'a0' })

      const result = await miniAppService.update('mover', { status: 'enabled' })

      expect(result.status).toBe('enabled')
      expect(result.orderKey > 'a5').toBe(true)
    })

    it('should keep the existing orderKey when status is unchanged', async () => {
      await seedCustom({ appId: 'stay', status: 'enabled', orderKey: 'a5' })

      const result = await miniAppService.update('stay', { status: 'enabled' })

      expect(result.orderKey).toBe('a5')
    })

    it('should keep the existing orderKey when a solo visible row changes status', async () => {
      await seedCustom({ appId: 'solo', status: 'enabled', orderKey: 'a5' })

      const result = await miniAppService.update('solo', { status: 'pinned' })

      expect(result.status).toBe('pinned')
      expect(result.orderKey).toBe('a5')
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      await seedCustom()
      const withWriteTx = application.get('DbService').withWriteTx as Mock
      withWriteTx.mockClear()

      await miniAppService.delete('custom-app')

      expect(withWriteTx).toHaveBeenCalledTimes(1)
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

    it('should reorder across enabled and pinned rows in the visible scope', async () => {
      await seedCustom({ appId: 'pinned-1', status: 'pinned', orderKey: 'a0' })
      await seedCustom({ appId: 'enabled-1', status: 'enabled', orderKey: 'a1' })
      await seedCustom({ appId: 'pinned-2', status: 'pinned', orderKey: 'a2' })

      await miniAppService.reorder([{ id: 'enabled-1', anchor: { after: 'pinned-2' } }])

      const [moved] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'enabled-1'))
      const [anchor] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'pinned-2'))
      expect(moved.orderKey > anchor.orderKey).toBe(true)
    })

    it('should throw NOT_FOUND for non-existent app IDs', async () => {
      await expect(
        miniAppService.reorder([{ id: 'nonexistent', anchor: { position: 'first' } }])
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should be a no-op when called with an empty batch', async () => {
      await seedCustom({ appId: 'untouched', orderKey: 'a0' })

      await expect(miniAppService.reorder([])).resolves.toBeUndefined()

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'untouched'))
      expect(row.orderKey).toBe('a0')
    })

    it('should reject visible/hidden batches with VALIDATION_ERROR (#3198896254)', async () => {
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

  describe('logo file lifecycle (DB-only file_ref slot)', () => {
    const FILE_ID = '019606a0-0000-7000-8000-0000000000aa'
    const FILE_ID_2 = '019606a0-0000-7000-8000-0000000000bb'

    /** Pre-store a file_entry the way the renderer would, so the FK + ref pass. */
    async function seedFileEntry(id: string) {
      await dbh.db.insert(fileEntryTable).values({ id, origin: 'internal', name: 'logo', ext: 'webp', size: 3 })
    }

    async function logoRefs(appId: string) {
      return dbh.db
        .select()
        .from(fileRefTable)
        .where(and(eq(fileRefTable.sourceType, 'mini_app_logo'), eq(fileRefTable.sourceId, appId)))
    }

    it('binding a file logo points the slot ref at it and nulls the logoKey column', async () => {
      await seedFileEntry(FILE_ID)
      await miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      // The set-logo command orchestrator binds an uploaded file via update().
      const updated = await miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'logo-app'))
      expect(row.logoKey).toBeNull()
      expect(row.logoFileId).toBe(FILE_ID)
      // Public DTO emits a `file:<id>` ref for the renderer to resolve.
      expect(updated.logo).toBe(`file:${FILE_ID}`)
      const refs = await logoRefs('logo-app')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID)
      expect(refs[0].role).toBe('logo')
    })

    it('update from upload to preset clears the slot ref and preserves the file_entry', async () => {
      await seedFileEntry(FILE_ID)
      await miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      await miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      const updated = await miniAppService.update('logo-app', { logo: { kind: 'key', key: 'application' } })

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'logo-app'))
      expect(row.logoKey).toBe('application')
      expect(row.logoFileId).toBeNull()
      expect(updated.logo).toBe('application')
      expect(await logoRefs('logo-app')).toHaveLength(0)
      // DB-only: the file_entry is preserved (no permanentDelete), per file policy.
      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, FILE_ID))
      expect(entry).toBeTruthy()
    })

    it('update replacing one upload with another repoints the slot ref', async () => {
      await seedFileEntry(FILE_ID)
      await seedFileEntry(FILE_ID_2)
      await miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      await miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      await miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID_2 } })

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'logo-app'))
      expect(row.logoFileId).toBe(FILE_ID_2)
      const refs = await logoRefs('logo-app')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID_2)
    })

    it('delete clears the slot ref and preserves the file_entry', async () => {
      await seedFileEntry(FILE_ID)
      await miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      await miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      await miniAppService.delete('logo-app')

      expect(await logoRefs('logo-app')).toHaveLength(0)
      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, FILE_ID))
      expect(entry).toBeTruthy()
    })
  })
})
