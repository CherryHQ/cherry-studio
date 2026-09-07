import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ArchiveModule from '../archive'

vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

// A reinstall and an upgrade go offline through the runtime service, which the unified
// container does not know; the quiesce has its own suite, so here it just runs.
// `vi.hoisted`: the factory below runs above every `const` in this file.
const { noteUpdateAvailable } = vi.hoisted(() => ({ noteUpdateAvailable: vi.fn() }))
vi.mock('../../activityLog', () => ({
  ACTIVITY_COUNT_FLUSH_MS: 60_000,
  miniAppActivityLog: {
    recordCall: vi.fn(),
    recordGrant: vi.fn(),
    flush: vi.fn(async () => {}),
    forget: vi.fn(async () => {})
  }
}))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    MiniAppRuntimeService: {
      withAppQuiesced: (_appId: string, mutate: () => Promise<unknown>) => mutate(),
      recovered: Promise.resolve(new Set<string>()),
      clearUnrepaired: vi.fn(),
      noteUpdateAvailable,
      beginUpdate: vi.fn(),
      noteUpdateProgress: vi.fn(),
      endUpdate: vi.fn(),
      forgetApp: vi.fn()
    }
  })
})
// The global electron mock has no `session.fromPartition`, and clearing data clears the partition.
vi.mock('electron', () => ({
  app: { getLocale: vi.fn(() => 'en-US') },
  session: {
    fromPartition: vi.fn(() => ({
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearCodeCaches: vi.fn().mockResolvedValue(undefined)
    }))
  }
}))

// Partial mock: one case forces the hash gate green while the file differs, another
// interleaves two previews — everything else runs the real archive code.
const sha256File = vi.fn()
const previewMiniAppArchive = vi.fn()
vi.mock('../archive', async (importOriginal) => ({
  ...(await importOriginal<typeof ArchiveModule>()),
  previewMiniAppArchive,
  sha256File
}))
const realArchive = await vi.importActual<typeof ArchiveModule>('../archive')

const {
  cancelPending,
  confirmPendingInstall,
  miniAppInstallConsentService,
  previewBuiltinForInstall,
  previewFileForInstall: previewFileRaw
} = await import('../installFlow')
const { applyUpdate } = await import('../webInstaller')
type InstallPreviewSummary = Awaited<ReturnType<typeof previewFileRaw>>
/** The install card — what a fresh database always gets; the install-over cases read the union. */
const asInstall = (p: InstallPreviewSummary) => {
  if (p.kind !== 'install') throw new Error(`expected an install preview, got ${p.kind}`)
  return p
}
const previewFileForInstall = async (zipPath: string, ownerId: string | null) =>
  asInstall(await previewFileRaw(zipPath, ownerId))

const MANIFEST = {
  id: 'com.example.mygame',
  name: 'My Game',
  description: 'A tiny sample game.',
  version: '1.0.0',
  entry: 'index.html',
  permissions: []
}

describe('installFlow', () => {
  const dbh = setupTestDatabase()

  let work: string
  beforeEach(() => {
    sha256File.mockImplementation(realArchive.sha256File)
    previewMiniAppArchive.mockImplementation(realArchive.previewMiniAppArchive)
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-flow-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const dir =
        key === 'feature.mini_app.publish_journal'
          ? path.join(work, '.publish-journal')
          : key === 'feature.mini_app.data'
            ? path.join(work, 'data')
            : key === 'feature.mini_app.builtin'
              ? path.join(work, 'builtin')
              : path.join(work, 'packages')
      return filename ? path.join(dir, filename) : dir
    })
  })
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

  async function packageBytes(over: Record<string, unknown> = {}): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ ...MANIFEST, ...over }))
    zip.file('index.html', '<h1>hi</h1>')
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  async function makePackage(over: Record<string, unknown> = {}): Promise<string> {
    const p = path.join(work, `pkg-${Math.random().toString(36).slice(2)}.miniapp`)
    await fs.promises.writeFile(p, await packageBytes(over))
    return p
  }

  const stagingLeftovers = () =>
    fs.existsSync(path.join(work, 'packages'))
      ? fs.readdirSync(path.join(work, 'packages')).filter((n) => n.startsWith('.staging-'))
      : []

  it('refuses a null owner before reading the package', async () => {
    // A nonexistent path: had the flow touched the file first, this would be ENOENT.
    await expect(previewFileForInstall(path.join(work, 'no-such.miniapp'), null)).rejects.toThrow(/managed window/i)
  })

  it('hands the BUILTIN card a real webp too, whatever the shipped tree contains', async () => {
    // The url and file previews both transcode; this one base64ed the raw file under an
    // `image/webp` label, so a builtin shipping a PNG produced a data URL whose declared
    // type was simply wrong. Bytes arriving inside the signed release are trusted, which
    // makes them safe — it does not make a wrong MIME type right.
    const sharp = (await import('sharp')).default
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#0f0' } })
      .png()
      .toBuffer()
    const root = path.join(work, 'builtin', MANIFEST.id)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({ ...MANIFEST, icon: { path: 'icon.png', sha256: 'a'.repeat(64) } })
    )
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>')
    fs.writeFileSync(path.join(root, 'icon.png'), png)

    const preview = asInstall(await previewBuiltinForInstall(MANIFEST.id, 'win-builtin'))

    const bytes = Buffer.from(preview.iconDataUrl!.split(',')[1], 'base64')
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp' })
  })

  it('keeps one pending consent per window', async () => {
    const first = await previewFileForInstall(await makePackage(), 'win-1')
    const second = await previewFileForInstall(await makePackage(), 'win-1')

    await expect(confirmPendingInstall(first.installToken, 'win-1')).rejects.toThrow(/unknown or expired/i)
    await expect(confirmPendingInstall(second.installToken, 'win-1')).resolves.toMatchObject({
      appId: 'com.example.mygame'
    })
  })

  it("refuses to hand one window's token to another, without consuming it", async () => {
    const preview = await previewFileForInstall(await makePackage(), 'win-1')

    await expect(confirmPendingInstall(preview.installToken, 'win-2')).rejects.toThrow(/unknown or expired/i)
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
    // The rightful owner still can — the probe did not burn the token.
    await expect(confirmPendingInstall(preview.installToken, 'win-1')).resolves.toBeDefined()
  })

  it('refuses an expired token at consumption', async () => {
    // Built BEFORE the fake clock: JSZip schedules its chunks on `setImmediate`.
    const zipPath = await makePackage()
    vi.useFakeTimers()
    try {
      const preview = await previewFileForInstall(zipPath, 'win-1')
      vi.setSystemTime(Date.now() + 11 * 60_000)

      await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/unknown or expired/i)
    } finally {
      vi.useRealTimers()
    }
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
  })

  it('tells the user plainly when the file changed between preview and confirm', async () => {
    const zipPath = await makePackage()
    const preview = await previewFileForInstall(zipPath, 'win-1')

    await fs.promises.writeFile(zipPath, await packageBytes({ version: '2.0.0' }))

    await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/changed since preview/i)
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
  })

  it('refuses a swap that beats the hash gate but changes the manifest', async () => {
    // The ms-window between hash and extract: force the hash gate green, swap the
    // manifest — the equality gate is the invariant that must catch it (design §10.2).
    const zipPath = await makePackage()
    const preview = await previewFileForInstall(zipPath, 'win-1')
    const pinned = await realArchive.sha256File(zipPath)
    await fs.promises.writeFile(zipPath, await packageBytes({ permissions: ['file.save'] }))
    sha256File.mockResolvedValueOnce(pinned)

    await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/changed since preview/i)
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
    expect(stagingLeftovers()).toEqual([])
  })

  it('installs the consented package and leaves no staging behind', async () => {
    const preview = await previewFileForInstall(await makePackage(), 'win-1')

    await confirmPendingInstall(preview.installToken, 'win-1')

    const [row] = dbh.db.select().from(miniAppTable).all()
    expect(row.appId).toBe('com.example.mygame')
    expect(stagingLeftovers()).toEqual([])
  })

  it('lets the newest preview win when an older one settles late', async () => {
    // A starts, B starts and registers, THEN A settles: the claim minted at request
    // START must win — settling order would let A evict B's shown token.
    let resolveA!: (value: unknown) => void
    previewMiniAppArchive
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve
          })
      )
      .mockImplementationOnce(realArchive.previewMiniAppArchive)
    const zipA = await makePackage({ version: '1.0.0' })

    const a = previewFileForInstall(zipA, 'win-1')
    const b = await previewFileForInstall(await makePackage({ version: '2.0.0' }), 'win-1')

    resolveA(await realArchive.previewMiniAppArchive(zipA))
    await expect(a).rejects.toThrow(/superseded/i)

    // The half the cancel-only compensation could never give back:
    await expect(confirmPendingInstall(b.installToken, 'win-1')).resolves.toBeDefined()
  })

  it('a failed staging removal does not mask a committed file install', async () => {
    const preview = await previewFileForInstall(await makePackage(), 'win-1')
    // Aimed at the STAGING tree by path, not at "the first rm": a fresh install now sweeps
    // its slate first, and a once-only rejection would land there and refuse the install
    // instead — a green case measuring the opposite of its name.
    const realRm = fs.promises.rm
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, options) =>
        String(target).includes('.staging-') ? Promise.reject(new Error('EPERM')) : realRm(target, options)
      )
    try {
      await expect(confirmPendingInstall(preview.installToken, 'win-1')).resolves.toBeDefined()
    } finally {
      rm.mockRestore()
    }
  })

  it('never lets a stale claim impersonate a fresh one', async () => {
    // The numeric-counter hazard needs the REUSE step: settle B so the slot empties,
    // then begin C — a counter re-mints A's "1", a UUID cannot.
    const svc = miniAppInstallConsentService
    const staleA = svc.beginPreview('win-9')
    const b = svc.beginPreview('win-9')
    svc.endPreview('win-9', b)
    const c = svc.beginPreview('win-9')

    const input = {
      ownerId: 'win-9',
      manifest: {} as never,
      payload: { kind: 'file', zipPath: '/x', zipSha256: 's' }
    } as const
    expect(() => svc.register(input, staleA)).toThrow(/superseded/i)
    // Positive control — C is live and registers; then leave the singleton clean.
    cancelPending(svc.register(input, c), 'win-9')
    svc.endPreview('win-9', c)
  })

  it('cancel drops the pending consent and is idempotent', async () => {
    const preview = await previewFileForInstall(await makePackage(), 'win-1')

    cancelPending(preview.installToken, 'win-1')
    cancelPending(preview.installToken, 'win-1')

    await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/unknown or expired/i)
  })

  describe('installing over an installed app', () => {
    const APP = MANIFEST.id
    const installAt = async (version: string, over: Record<string, unknown> = {}) => {
      const preview = await previewFileForInstall(await makePackage({ version, ...over }), 'win-1')
      return confirmPendingInstall(preview.installToken, 'win-1')
    }
    const saveFile = () => path.join(work, 'data', APP, 'storage.json')
    const writeSave = () => {
      fs.mkdirSync(path.dirname(saveFile()), { recursive: true })
      fs.writeFileSync(saveFile(), '{}')
    }
    const installedRow = () =>
      dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP)).all()[0]
    const appRow = () => dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, APP)).all()[0]

    it('offers a newer package as an upgrade: the update flow, data kept, snapshot taken', async () => {
      await installAt('1.0.0')
      writeSave()

      const preview = await previewFileRaw(
        await makePackage({ version: '2.0.0', permissions: ['storage.get'] }),
        'win-1'
      )

      expect(preview).toMatchObject({
        kind: 'upgrade',
        source: 'file',
        installed: { version: '1.0.0', source: 'file' },
        update: { status: 'needs-consent', version: '2.0.0', added: ['storage.get'] }
      })
      expect(noteUpdateAvailable).not.toHaveBeenCalledWith(APP, expect.any(String))
      if (preview.kind !== 'upgrade') throw new Error('unreachable')
      // The upgrade preview extracts once for the tree hash and keeps nothing.
      expect(stagingLeftovers()).toEqual([])

      await applyUpdate(APP, { updateToken: preview.update.updateToken, consented: true })

      expect(installedRow()).toMatchObject({ version: '2.0.0', previousContentHash: expect.any(String) })
      expect(fs.existsSync(saveFile())).toBe(true)
    })

    it('offers the same version as a reinstall and refuses a confirm that does not answer it', async () => {
      await installAt('1.0.0')

      const preview = await previewFileRaw(await makePackage({ version: '1.0.0' }), 'win-1')

      expect(preview).toMatchObject({
        kind: 'install',
        installed: { version: '1.0.0', source: 'file', relation: 'same' }
      })
      if (preview.kind !== 'install') throw new Error('unreachable')
      await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/already installed/i)
      expect(installedRow().version).toBe('1.0.0')
    })

    it('reinstalls in place: position, status and data survive; clear-data wipes the data', async () => {
      await installAt('1.0.0')
      dbh.db.update(miniAppTable).set({ status: 'pinned', orderKey: 'zz' }).where(eq(miniAppTable.appId, APP)).run()
      writeSave()

      const kept = await previewFileForInstall(await makePackage({ version: '1.0.0' }), 'win-1')
      await confirmPendingInstall(kept.installToken, 'win-1', undefined, { clearData: false })

      expect(appRow()).toMatchObject({ status: 'pinned', orderKey: 'zz' })
      expect(installedRow()).toMatchObject({ version: '1.0.0', previousContentHash: null })
      expect(fs.existsSync(saveFile())).toBe(true)
      // No snapshot: a reinstall is not an update, and `.backup` would offer a rollback the rows do not describe.
      expect(fs.existsSync(path.join(work, 'packages', `${APP}.backup`))).toBe(false)
      expect(stagingLeftovers()).toEqual([])

      const wiped = await previewFileForInstall(await makePackage({ version: '1.0.0' }), 'win-1')
      await confirmPendingInstall(wiped.installToken, 'win-1', undefined, { clearData: true })

      expect(fs.existsSync(saveFile())).toBe(false)
      expect(appRow()).toMatchObject({ status: 'pinned', orderKey: 'zz' })
    })

    it('names an older package a downgrade', async () => {
      await installAt('1.2.0')

      await expect(previewFileRaw(await makePackage({ version: '1.1.0' }), 'win-1')).resolves.toMatchObject({
        kind: 'install',
        installed: { version: '1.2.0', relation: 'downgrade' }
      })
    })

    it('refuses a package whose id is already a website entry', async () => {
      dbh.db
        .insert(miniAppTable)
        .values({
          appId: APP,
          kind: 'site',
          presetMiniAppId: null,
          name: 'Site',
          url: 'https://x.example',
          status: 'enabled',
          orderKey: 'a0'
        })
        .run()

      await expect(previewFileRaw(await makePackage(), 'win-1')).rejects.toThrow(/website entry/i)
    })

    it('refuses to reinstall over an app that moved since the card was shown', async () => {
      await installAt('1.0.0')
      const preview = await previewFileForInstall(await makePackage({ version: '1.0.0' }), 'win-1')
      // Another window upgraded it meanwhile: the card's "already installed at 1.0.0" is stale.
      dbh.db
        .update(miniAppInstallationTable)
        .set({ version: '1.5.0' })
        .where(eq(miniAppInstallationTable.appId, APP))
        .run()

      await expect(
        confirmPendingInstall(preview.installToken, 'win-1', undefined, { clearData: false })
      ).rejects.toThrow(/changed since/i)
      expect(installedRow().version).toBe('1.5.0')
    })
  })
})
