import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { insertSingleFileRefTx } from '@data/services/utils/singleFileRef'
import type { FileEntryId } from '@shared/data/types/file'
import type { MiniAppManifest } from '@shared/types/miniAppManifest'

// Real path down to the row: only the WebP transcode and the file store are stubbed, so
// the `kind='app'` guard in MiniAppService is exercised instead of mocked away.
const { transcode, createInternalEntry, permanentDelete } = vi.hoisted(() => {
  let seq = 0
  const transcode = vi.fn(async (bytes: Uint8Array) => Buffer.from(bytes))
  const createInternalEntry = vi.fn(
    async ({ data, cleanupPolicy }: { data: Uint8Array; cleanupPolicy: 'delete_when_unreferenced' }) => {
      const entry = { id: `f${++seq}`, origin: 'internal' as const, name: 'image', ext: 'webp', size: data.byteLength }
      dbh.db
        .insert(fileEntryTable)
        .values({ ...entry, cleanupPolicy })
        .run()
      return entry
    }
  )
  const permanentDelete = vi.fn(async (id: string) => {
    dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, id)).run()
  })
  return { transcode, createInternalEntry, permanentDelete }
})
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: transcode }))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  const { MockMainFileManagerExport } = await import('@test-mocks/main/FileManager')
  return mockMiniAppApplication({
    FileManager: { ...MockMainFileManagerExport.fileManager, createInternalEntry, permanentDelete }
  })
})

const { applyPackagedIcon } = await import('../icon')

// Module-level so the hoisted FileManager stub writes to the same DB the service reads.
const dbh = setupTestDatabase()

const APP_ID = 'com.example.mygame'
const ICON_SHA = 'a'.repeat(64) // any valid-shaped digest; this suite does not verify it
const PRIOR_ICON = '019606a0-0000-7000-8000-0000000000aa' as FileEntryId
const manifest: MiniAppManifest = {
  id: APP_ID,
  name: { en: 'My Game' },
  description: { en: 'A tiny sample game.' },
  version: '1.0.0',
  entry: 'index.html',
  permissions: [],
  optionalPermissions: [],
  network: []
}

/** The row the installer commits before it applies the icon: `kind='app'` plus its installation. */
function seedInstalledApp() {
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
    .values({ appId: APP_ID, version: '1.0.0', contentHash: 'sha256:x', source: 'file', manifestJson: manifest })
    .run()
}

/** The previous version's icon, still bound — what an update or rollback must replace. */
function seedPriorIcon() {
  dbh.db
    .insert(fileEntryTable)
    .values({ id: PRIOR_ICON, origin: 'internal', name: 'image', ext: 'webp', size: 3 })
    .run()
  insertSingleFileRefTx(dbh.db, miniAppLogoFileRefTable, APP_ID, PRIOR_ICON)
}

const logoRefs = () =>
  dbh.db.select().from(miniAppLogoFileRefTable).where(eq(miniAppLogoFileRefTable.sourceId, APP_ID)).all()

let root: string
beforeEach(() => {
  vi.clearAllMocks()
  seedInstalledApp()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-icon-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('applyPackagedIcon', () => {
  it('binds the packaged icon bytes into the installed app row', async () => {
    // The bug this guards: `update()` rejecting `logo` on a `kind='app'` row, so the
    // installer's own write is refused and every local app ships with no icon.
    // A REAL 1x1 PNG: the icon path checks magic bytes before a decoder sees them, so a
    // stand-in string is refused — which is the point of the check.
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC',
      'base64'
    )
    fs.writeFileSync(path.join(root, 'icon.png'), bytes)

    await applyPackagedIcon(APP_ID, root, { ...manifest, icon: { path: 'icon.png', sha256: ICON_SHA } })

    expect(transcode).toHaveBeenCalledWith(new Uint8Array(bytes))
    const refs = logoRefs()
    expect(refs).toHaveLength(1)
    expect(miniAppService.getByAppId(APP_ID).logoSrc).toBe(`file:///mock/files/${refs[0].fileEntryId}.webp`)
    expect(permanentDelete).not.toHaveBeenCalled()
  })

  it('falls back to the default logo when no icon is declared', async () => {
    seedPriorIcon()

    await applyPackagedIcon(APP_ID, root, manifest)

    expect(createInternalEntry).not.toHaveBeenCalled()
    expect(logoRefs()).toHaveLength(0)
    expect(miniAppService.getByAppId(APP_ID).logoSrc).toBeUndefined()
  })

  it('falls back to the default logo when the icon cannot be transcoded', async () => {
    seedPriorIcon()
    fs.writeFileSync(path.join(root, 'icon.png'), Buffer.from('not-an-image'))
    transcode.mockRejectedValueOnce(new Error('decode failed'))

    await applyPackagedIcon(APP_ID, root, { ...manifest, icon: { path: 'icon.png', sha256: ICON_SHA } })

    expect(logoRefs()).toHaveLength(0)
    expect(miniAppService.getByAppId(APP_ID).logoSrc).toBeUndefined()
  })

  it('refuses an icon resolving outside the package', async () => {
    seedPriorIcon()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-outside-'))
    fs.writeFileSync(path.join(outside, 'secret.png'), 'SECRET')
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'icon.png'))

    await applyPackagedIcon(APP_ID, root, { ...manifest, icon: { path: 'icon.png', sha256: ICON_SHA } })

    expect(transcode).not.toHaveBeenCalled()
    expect(logoRefs()).toHaveLength(0)
    expect(miniAppService.getByAppId(APP_ID).logoSrc).toBeUndefined()
    fs.rmSync(outside, { recursive: true, force: true })
  })
})
