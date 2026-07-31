import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { ErrorCode } from '@shared/data/api/errors'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import type { MiniApp, SiteMiniApp } from '@shared/data/types/miniApp'
import type { UniqueModelId } from '@shared/data/types/model'
import type { MiniAppManifest } from '@shared/types/miniAppManifest'

/** Every row the service maps today is a site row; narrow so site-only fields can be asserted. */
function expectSite(app: MiniApp): SiteMiniApp {
  if (app.kind !== 'site') throw new Error(`Expected a site mini app, got kind=${app.kind}`)
  return app
}

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
      const result = expectSite(miniAppService.getByAppId('custom-app'))
      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.presetMiniAppId).toBeNull()
      expect(result.bordered).toBeUndefined()
      expect(result.background).toBeUndefined()
      expect(result.supportedRegions).toBeUndefined()
    })

    it('should return a preset-derived miniapp with presetMiniAppId set', async () => {
      await seedPreset('openai')
      const result = expectSite(miniAppService.getByAppId('openai'))
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
        logo: { kind: 'key', key: 'custom-logo' }
      }

      const result = expectSite(miniAppService.create(dto))

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
        logo: { kind: 'key', key: 'custom-logo' }
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
          logo: { kind: 'key', key: 'fake' }
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
          logo: { kind: 'key', key: 'dup' }
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

      const result = expectSite(
        miniAppService.update('custom-app', {
          name: 'Renamed App',
          url: 'https://renamed.app',
          logo: { kind: 'key', key: 'icon:renamed' }
        })
      )

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

  describe('logo file lifecycle (DB-only file_ref slot)', () => {
    const FILE_ID = '019606a0-0000-7000-8000-0000000000aa'
    const FILE_ID_2 = '019606a0-0000-7000-8000-0000000000bb'

    /** Pre-store a file_entry the way the renderer would, so the FK + ref pass. */
    async function seedFileEntry(id: string) {
      await dbh.db.insert(fileEntryTable).values({ id, origin: 'internal', name: 'logo', ext: 'webp', size: 3 })
    }

    async function logoRefs(appId: string) {
      return dbh.db.select().from(miniAppLogoFileRefTable).where(eq(miniAppLogoFileRefTable.sourceId, appId))
    }

    it('binding a file logo points the slot ref at it and nulls the logoKey column', async () => {
      await seedFileEntry(FILE_ID)
      miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      // The set-logo command orchestrator binds an uploaded file via update().
      const updated = miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'logo-app'))
      expect(row.logoKey).toBeNull()
      // The uploaded logo lives ONLY in the ref row (single source of truth);
      // the DTO's `logo` key stays clear and the renderer-facing URL resolves
      // main-side onto `logoSrc` (FileManager mock → deterministic file:// path).
      expect(updated.logo).toBeUndefined()
      expect(updated.logoSrc).toBe(`file:///mock/files/${FILE_ID}.webp`)
      const refs = await logoRefs('logo-app')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID)
    })

    it('update from upload to preset clears the slot ref and preserves the file_entry', async () => {
      await seedFileEntry(FILE_ID)
      miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      const updated = miniAppService.update('logo-app', { logo: { kind: 'key', key: 'application' } })

      const [row] = await dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, 'logo-app'))
      expect(row.logoKey).toBe('application')
      expect(updated.logo).toBe('application')
      expect(await logoRefs('logo-app')).toHaveLength(0)
      // DB-only: the file_entry is preserved (no permanentDelete), per file policy.
      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, FILE_ID))
      expect(entry).toBeTruthy()
    })

    it('update replacing one upload with another repoints the slot ref', async () => {
      await seedFileEntry(FILE_ID)
      await seedFileEntry(FILE_ID_2)
      miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID_2 } })

      const refs = await logoRefs('logo-app')
      expect(refs).toHaveLength(1)
      expect(refs[0].fileEntryId).toBe(FILE_ID_2)
    })

    it('delete clears the slot ref and preserves the file_entry', async () => {
      await seedFileEntry(FILE_ID)
      miniAppService.create({ appId: 'logo-app', name: 'Logo App', url: 'https://logo.app' })
      miniAppService.update('logo-app', { logo: { kind: 'file', fileId: FILE_ID } })

      miniAppService.delete('logo-app')

      expect(await logoRefs('logo-app')).toHaveLength(0)
      const [entry] = await dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, FILE_ID))
      expect(entry).toBeTruthy()
    })
  })

  describe('installed (kind=app) rows', () => {
    /** A `kind: 'app'` row plus the installation row that gives it a version and manifest. */
    const seedInstalledApp = (appId: string, version: string, over: Partial<MiniAppManifest> = {}) => {
      dbh.db
        .insert(miniAppTable)
        .values({
          appId,
          kind: 'app',
          presetMiniAppId: null,
          name: 'My Game',
          url: `cherry-miniapp://${appId}/index.html`,
          status: 'enabled',
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .insert(miniAppInstallationTable)
        .values({
          appId,
          version,
          contentHash: 'sha256:x',
          source: 'file',
          manifestJson: {
            id: appId,
            name: { en: 'My Game' },
            description: { en: 'A tiny sample game.' },
            version,
            entry: 'index.html',
            permissions: [],
            optionalPermissions: [],
            network: [],
            ...over
          }
        })
        .run()
    }

    /**
     * The UI language the mapper resolves localized names against.
     *
     * `MockMainPreferenceServiceUtils`, not `PreferenceService.set()`: the mock's `set`
     * is async and would be a floating promise here, and the mock's state is
     * module-level, so it must be reset between tests or a language set in one test
     * leaks into every later one.
     */
    const setLanguage = (language: LanguageVarious) =>
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', language)

    afterEach(() => MockMainPreferenceServiceUtils.resetMocks())

    it('reports the installed version for a local app', () => {
      seedInstalledApp('com.example.a', '1.2.0')
      expect(miniAppService.list().find((a) => a.appId === 'com.example.a')).toMatchObject({
        kind: 'app',
        version: '1.2.0'
      })
    })

    it('refuses to repoint an installed app at another URL', () => {
      // The bug this guards: a local app has presetMiniAppId === null, so the preset
      // guard reads it as a custom site and lets the URL leave the sandbox.
      seedInstalledApp('com.example.a', '1.0.0')
      expect(() => miniAppService.update('com.example.a', { url: 'https://evil.com' })).toThrow()
    })

    it('stores a per-app model through PATCH and clears it with null', () => {
      // Round-trips through the read path: a write that lands on the wrong row (or on no
      // row) leaves the listed value unchanged, which a "did not throw" check would miss.
      seedInstalledApp('com.example.a', '1.0.0')
      const modelId = 'openai::gpt-4o-mini' as UniqueModelId

      expect(miniAppService.update('com.example.a', { aiModelId: modelId })).toMatchObject({ aiModelId: modelId })
      expect(miniAppService.getByAppId('com.example.a')).toMatchObject({ kind: 'app', aiModelId: modelId })

      miniAppService.update('com.example.a', { aiModelId: null })
      expect(miniAppService.getByAppId('com.example.a')).toMatchObject({ kind: 'app', aiModelId: null })
    })

    it('stores the quick slot on its own, leaving the default slot untouched', () => {
      // One SET for both columns: a write that touched the slot it was not given would
      // silently reset the other one to null.
      seedInstalledApp('com.example.a', '1.0.0')
      const modelId = 'openai::gpt-4o-mini' as UniqueModelId
      const quickId = 'openai::gpt-4.1-nano' as UniqueModelId
      miniAppService.update('com.example.a', { aiModelId: modelId })

      miniAppService.update('com.example.a', { aiQuickModelId: quickId })
      expect(miniAppService.getByAppId('com.example.a')).toMatchObject({ aiModelId: modelId, aiQuickModelId: quickId })

      miniAppService.update('com.example.a', { aiQuickModelId: null })
      expect(miniAppService.getByAppId('com.example.a')).toMatchObject({ aiModelId: modelId, aiQuickModelId: null })
    })

    it('refuses a per-app model on a site row', () => {
      // There is no installation row to hold it; an UPDATE there matches nothing and
      // "succeeds", so the guard has to come from the kind, not from the write.
      miniAppService.create({ appId: 'site-x', name: 'Site X', url: 'https://x.example' })
      expect(() => miniAppService.update('site-x', { aiModelId: 'openai::gpt-4o-mini' as UniqueModelId })).toThrow(
        /installed/i
      )
    })

    it('refuses to swap an installed app icon through the generic path', () => {
      // Drop `logo` from IDENTITY_FIELDS and the other three cases still pass while
      // icon-swapping stays open. `LogoBindInput`, not a string — typecheck sees it first.
      seedInstalledApp('com.example.a', '1.0.0')
      expect(() => miniAppService.update('com.example.a', { logo: { kind: 'key', key: 'chatgpt' } })).toThrow(
        /package/i
      )
    })

    it('binds a packaged icon through the installer entry', async () => {
      // The bug this guards: the identity guard also refusing the installer's own
      // write, so every local app ships with the placeholder avatar.
      const FILE_ID = '019606a0-0000-7000-8000-0000000000cc'
      seedInstalledApp('com.example.a', '1.0.0')
      await dbh.db
        .insert(fileEntryTable)
        .values({ id: FILE_ID, origin: 'internal', name: 'logo', ext: 'webp', size: 3 })

      miniAppService.setInstalledLogo('com.example.a', { kind: 'file', fileId: FILE_ID })

      expect(miniAppService.getByAppId('com.example.a').logoSrc).toBe(`file:///mock/files/${FILE_ID}.webp`)
    })

    it('keeps the installer entry off site rows', async () => {
      // A site's logo is user-owned (custom, via update()) or seeder-owned (preset);
      // the installer bypass must not become a second way to swap it.
      await seedCustom()
      expect(() => miniAppService.setInstalledLogo('custom-app', { kind: 'default' })).toThrow(/installed/i)
    })

    it('refuses to delete an installed app through the generic path', () => {
      // Deleting the row bypasses the journal and leaves the package directory behind.
      seedInstalledApp('com.example.a', '1.0.0')
      expect(() => miniAppService.delete('com.example.a')).toThrow(/uninstall/i)
    })

    it('still allows enabling and reordering an installed app', () => {
      seedInstalledApp('com.example.a', '1.0.0')
      expect(() => miniAppService.update('com.example.a', { status: 'disabled' })).not.toThrow()
    })

    it('shows the Chinese name under a Chinese UI and the English one otherwise', () => {
      // The bug this guards: storing one resolved string. Switching the app language
      // would then require rewriting rows, and until someone did, the name would lie.
      seedInstalledApp('com.example.a', '1.0.0', { name: { en: 'My Game', zh: '我的游戏' } })

      setLanguage('zh-CN')
      expect(miniAppService.getByAppId('com.example.a').name).toBe('我的游戏')

      setLanguage('de-DE')
      expect(miniAppService.getByAppId('com.example.a').name).toBe('My Game')
    })

    it('resolves a name when the user has never picked a language', () => {
      // `app.language` starts null, and a null locale crashes `locale.split()`.
      // `getAppLanguage()` is the existing fallback chain.
      seedInstalledApp('com.example.a', '1.0.0', { name: { en: 'My Game', zh: '我的游戏' } })

      expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.language')).toBeNull()
      expect(miniAppService.getByAppId('com.example.a').name).toBe('My Game')
    })

    it('does not leak internal columns to the renderer', () => {
      // The bug this guards: `{ ...row }` in the mapper — it ships `logoKey` and the
      // `manifestJson` blob, and hands out numbers where the type promises ISO strings.
      seedInstalledApp('com.example.a', '1.0.0')
      const app = miniAppService.getByAppId('com.example.a')

      expect(app).not.toHaveProperty('logoKey')
      expect(app).not.toHaveProperty('manifestJson')
      expect(app.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('returns a complete local app from update(), not just the written row', () => {
      // The bug this guards: joining only in list/get, so `update()` returns the
      // un-joined row it just wrote — a LocalMiniApp with no version.
      seedInstalledApp('com.example.a', '1.0.0')
      expect(miniAppService.update('com.example.a', { status: 'disabled' })).toMatchObject({
        kind: 'app',
        version: '1.0.0'
      })
    })
  })
})
