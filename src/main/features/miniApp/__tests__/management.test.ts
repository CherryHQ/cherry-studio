import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeStorage } from '../capabilities/storageFile'
import { pendingDeclaredAdditions } from '../grants'
import type * as WebInstallerModule from '../install/webInstaller'
import { miniAppBackupPath, miniAppInstallPath } from '../paths'

const spy = vi.hoisted(() => ({ order: [] as string[], attention: [] as string[][], rowsOnEntry: -1 }))
// `reclaimEntries` reaches FileManager after the commit; without it in the mock the
// reclaim swallows a "service not registered" and the assertion reds for the wrong reason.
const permanentDelete = vi.hoisted(() => vi.fn(async () => undefined))
// `session.fromPartition` is reached only by the net-revoke path; without it that case
// dies inside Electron instead of asserting anything.
const closeAllConnections = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('electron', () => ({
  // `miniAppDetail` resolves the display locale through `getAppLanguage`.
  app: { getLocale: () => 'en-US' },
  dialog: { showOpenDialog: vi.fn() },
  // The REAL clear-data clears the app's partition on its way out.
  session: {
    fromPartition: () => ({
      closeAllConnections,
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearCodeCaches: vi.fn().mockResolvedValue(undefined)
    })
  }
}))

// Loaded INSIDE the factory: a static import is not initialised when the hoisted mock runs.
vi.mock('../activityLog', () => ({
  ACTIVITY_COUNT_FLUSH_MS: 60_000,
  miniAppActivityLog: {
    recordCall: vi.fn(),
    recordGrant: vi.fn(),
    flush: vi.fn(async () => {}),
    forget: vi.fn(async () => {})
  }
}))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('./applicationMock')
  return mockMiniAppApplication({
    FileManager: { permanentDelete },
    MiniAppRuntimeService: {
      withAppQuiesced: vi.fn(async (appId: string, mutate: () => Promise<unknown>) => {
        // Records the WORLD, not the wrapper's own entry and exit: deleting first and
        // then quiescing produces the same order. Only the row count separates them.
        spy.rowsOnEntry = countRows(appId)
        spy.order.push(`quiesce:${appId}`)
        const result = await mutate()
        spy.order.push('mutate')
        return result
      }),
      // NOT `vi.fn()`: a no-op never publishes state, so the badge assertion below
      // passes for a build that recomputes nothing. Derive, then broadcast.
      broadcastAttentionState: vi.fn(() => {
        // Same reason as `countRows`: `dbh` is scoped to the describe block.
        const pending = application
          .get('DbService')
          .getDb()
          .select()
          .from(miniAppInstallationTable)
          .all()
          .map((r) => ({
            appId: r.appId,
            updateVersion: null,
            updating: null,
            pendingPermissions: pendingDeclaredAdditions(
              r.appId,
              MiniAppManifestSchema.parse(r.manifestJson),
              r.consentedDeclaredJson
            )
          }))
          .filter((entry) => entry.pendingPermissions.length > 0)
        application.get('CacheService').setShared('mini_app.attention', pending)
      }),
      clearPendingSnooze: vi.fn(),
      updateVersionOf: vi.fn(() => null)
    },
    CacheService: {
      setShared: vi.fn((_key: string, apps: Array<{ appId: string }>) => {
        spy.attention.push(apps.map((app) => app.appId))
      })
    }
  })
})

vi.mock('../runtime/events', () => ({ emitToApp: vi.fn() }))

// The real `checkForUpdate` goes online; a stub makes "delegated or short-circuited"
// observable without a network, which is all the on-open gate has to decide.
const checkForUpdate = vi.hoisted(() => vi.fn(async () => ({ status: 'current' as const })))
vi.mock('../install/webInstaller', async (importOriginal) => ({
  ...(await importOriginal<typeof WebInstallerModule>()),
  checkForUpdate
}))

const { checkUpdateOnOpen, clearMiniAppData, grantPendingAdditions, miniAppDetail, revokeMiniAppGrant } = await import(
  '../management'
)
const { listGrants } = await import('../grants')

const APP_ID = 'com.example.mygame'
const FILE_ID = 'file-entry-1'

/**
 * Storage rows + file refs — exactly what both operations are supposed to remove.
 *
 * Reads through `application.get('DbService')` rather than the `dbh` handle: `dbh` is
 * declared INSIDE `describe`, and both this helper and the hoisted `vi.mock` factory
 * below live at module scope, where that binding does not exist. `setupTestDatabase`
 * points the mocked DbService at the same database, so this is the same rows.
 */
const countRows = (appId: string) => {
  const db = application.get('DbService').getDb()
  return db.select().from(miniAppFileRefTable).where(eq(miniAppFileRefTable.sourceId, appId)).all().length
}

describe('mini app management', () => {
  const dbh = setupTestDatabase()
  let root: string

  // The unified mock's `getPath` returns `/mock/<key>`, which no ordinary user can
  // create — the save file is real, so point every root at a temp dir.
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-management-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const dir = path.join(root, key)
      return filename ? path.join(dir, filename) : dir
    })
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  /**
   * An installed app that actually has something to clear: one stored key, one file
   * ref (with the `file_entry` row its FK requires) and one grant. An empty fixture
   * makes every delete assertion below vacuously true.
   *
   * `permissions: ['storage.*']` with an empty consent baseline is what gives
   * `pendingDeclaredAdditions` something to return — the badge case needs the app to be
   * flagged BEFORE it is granted, or "not flagged after" proves nothing.
   */
  const seedInstalled = (over: { permissions?: string[]; optionalPermissions?: string[] } = {}) => {
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP_ID,
        kind: 'app',
        presetMiniAppId: null,
        name: 'My Game',
        url: `cherry-miniapp://${APP_ID}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId: APP_ID,
        version: '1.0.0',
        contentHash: 'sha256:x',
        source: 'file',
        manifestJson: {
          id: APP_ID,
          name: { en: 'My Game' },
          description: { en: 'A tiny sample game.' },
          version: '1.0.0',
          entry: 'index.html',
          permissions: over.permissions ?? ['storage.*'],
          optionalPermissions: over.optionalPermissions ?? [],
          network: []
        },
        consentedDeclaredJson: []
      })
      .run()
    writeStorage(APP_ID, { save: '{}' })
    dbh.db.insert(fileEntryTable).values({ id: FILE_ID, origin: 'internal', name: 'blob', ext: 'bin', size: 1 }).run()
    dbh.db.insert(miniAppFileRefTable).values({ fileEntryId: FILE_ID, sourceId: APP_ID, logicalName: 'save.bin' }).run()
    dbh.db.insert(miniAppGrantTable).values({ appId: APP_ID, permission: 'storage.get', grantedVersion: '1.0.0' }).run()
  }

  it('reports how much disk the installed package and its rollback snapshot take', async () => {
    seedInstalled()
    const install = miniAppInstallPath(APP_ID)
    fs.mkdirSync(path.join(install, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(install, 'index.html'), Buffer.alloc(1000))
    fs.writeFileSync(path.join(install, 'assets', 'a.png'), Buffer.alloc(24))

    expect(await miniAppDetail(APP_ID)).toMatchObject({ packageBytes: 1024, snapshotBytes: 0 })

    // A successful update leaves the old tree in `.backup` for rollback: disk the app owns too.
    const backup = miniAppBackupPath(APP_ID)
    fs.mkdirSync(backup, { recursive: true })
    fs.writeFileSync(path.join(backup, 'index.html'), Buffer.alloc(512))
    expect(await miniAppDetail(APP_ID)).toMatchObject({ packageBytes: 1024, snapshotBytes: 512 })
  })

  it('clearMiniAppData takes the app offline before it deletes anything', async () => {
    // Asserts ORDER: a wrapper that deletes first and quiesces afterwards satisfies
    // `toHaveBeenCalled` and fixes nothing.
    seedInstalled()
    spy.order.length = 0
    spy.rowsOnEntry = -1
    expect(countRows(APP_ID)).toBeGreaterThan(0) // the fixture really has something to delete

    await clearMiniAppData(APP_ID)

    expect(spy.order).toEqual([`quiesce:${APP_ID}`, 'mutate'])
    // What makes the line above mean anything: nothing had been deleted yet at the
    // moment the app was taken offline, and everything is gone by the time it returns.
    expect(spy.rowsOnEntry).toBeGreaterThan(0)
    expect(countRows(APP_ID)).toBe(0)
  })

  it('refuses to revoke a REQUIRED permission', async () => {
    // The guard that makes "required" mean anything: without it the renderer hands in a
    // required leaf and gets an installed-but-broken app, and every other case still passes.
    seedInstalled({ permissions: ['storage.get'], optionalPermissions: ['notification.show'] })

    await expect(revokeMiniAppGrant(APP_ID, 'storage.get')).rejects.toThrow(/optional/i)
    expect(listGrants(APP_ID)).toContain('storage.get')
  })

  it('revokes a capability without taking the app offline', async () => {
    // Negative control: quiescing EVERY revoke would close the app whenever a user
    // unticks one checkbox, and the bridge already re-checks capabilities per call.
    // `storage.get` is declared OPTIONAL here — the case above proves a required leaf
    // never gets this far.
    seedInstalled({ permissions: ['storage.set'], optionalPermissions: ['storage.get'] })
    spy.order.length = 0

    await revokeMiniAppGrant(APP_ID, 'storage.get')

    expect(spy.order).toEqual([])
    expect(closeAllConnections).not.toHaveBeenCalled()
    expect(listGrants(APP_ID)).not.toContain('storage.get')
  })

  it('reclaims the file blobs as part of clearing data, not an hour later', async () => {
    // Without this the entries stay listed on the files page (§3.6) and on disk for the
    // grace hour — "clear data" is then a claim the user can watch being false.
    seedInstalled()

    await clearMiniAppData(APP_ID)

    expect(permanentDelete).toHaveBeenCalledWith(FILE_ID)
  })

  it('recomputes the badge after granting what Cherry added', async () => {
    // BEFORE and AFTER, not just after: a bare `not.toContain(APP_ID)` also passes when
    // the app was never flagged, when nothing broadcast, and when nothing ran.
    seedInstalled()
    spy.attention.length = 0
    application.get('MiniAppRuntimeService').broadcastAttentionState()
    expect(spy.attention.at(-1)).toContain(APP_ID)

    await grantPendingAdditions(APP_ID)

    expect(spy.attention.at(-1)).not.toContain(APP_ID)
  })

  describe('checkUpdateOnOpen', () => {
    /** `seedInstalled` writes a `source='file'` row; a web app is the same row repointed at an origin. */
    const asWebApp = () =>
      dbh.db
        .update(miniAppInstallationTable)
        .set({
          source: 'url',
          sourceUrl: 'https://example.com/mygame/manifest.json',
          sourceOrigin: 'https://example.com',
          sourceOriginCn: 'https://cn.example.com'
        })
        .run()

    beforeEach(() => checkForUpdate.mockClear())
    afterEach(() => MockMainPreferenceServiceUtils.resetMocks())

    it('delegates a web app to the real check while the global preference is on', async () => {
      seedInstalled()
      asWebApp()

      await checkUpdateOnOpen(APP_ID)

      expect(checkForUpdate).toHaveBeenCalledWith(APP_ID)
    })

    it('skips the check for every app once the global preference is off', async () => {
      seedInstalled()
      asWebApp()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.check_updates_on_open', false)

      expect(await checkUpdateOnOpen(APP_ID)).toEqual({ status: 'current' })
      expect(checkForUpdate).not.toHaveBeenCalled()
    })

    it('never checks a local package on open, whatever the preference says', async () => {
      // `checkForUpdate` refuses a `source='file'` app outright; reaching it would turn
      // every open of a local app into a logged error.
      seedInstalled()

      expect(await checkUpdateOnOpen(APP_ID)).toEqual({ status: 'current' })
      expect(checkForUpdate).not.toHaveBeenCalled()
    })
  })
})
