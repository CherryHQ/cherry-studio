import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const APP_ID = 'com.cherrystudio.miniapp.sample'

// Installing for real writes staging trees and journals — the unified mock's
// `/mock/<key>` paths are not creatable, so getPath is redirected per key below.
vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

// `checkForUpdate` records its answer on the runtime service, which the unified
// container does not know; the badge itself has its own suite.
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
      noteUpdateAvailable: vi.fn()
    }
  })
})

// Real builtin trees, not mocks. Stage-unit cases inject `builtinRoot`; the chain
// cases instead point the `feature.mini_app.builtin` KEY at the temp root.
const { stageBuiltinMiniApp } = await import('../builtin')
const { confirmPendingInstall, previewBuiltinForInstall: previewBuiltinRaw } = await import('../installFlow')
type InstallPreviewSummary = Awaited<ReturnType<typeof previewBuiltinRaw>>
/** Every case here previews onto an empty database, so the card is always the install one. */
const asInstall = (p: InstallPreviewSummary) => {
  if (p.kind !== 'install') throw new Error(`expected an install preview, got ${p.kind}`)
  return p
}
const previewBuiltinForInstall = async (appId: string, ownerId: string | null) =>
  asInstall(await previewBuiltinRaw(appId, ownerId))
const { installExtracted } = await import('../installer')
const { checkForUpdate } = await import('../webInstaller')

/** A shipped tree the way electron-builder lays it out: unpacked, manifest + icon. */
async function makeBuiltinPackage(appId: string, at?: string): Promise<string> {
  const root = at ?? (await fs.promises.mkdtemp(path.join(os.tmpdir(), 'builtin-')))
  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.writeFile(path.join(root, 'index.html'), '<!doctype html>')
  // Icon FIRST: `icon.sha256` is required whenever `icon` is present and must digest the
  // bytes actually written, or install fails for a reason unrelated to the case at hand.
  const sharp = (await import('sharp')).default
  const icon = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#000' } })
    .webp()
    .toBuffer()
  await fs.promises.writeFile(path.join(root, 'icon.webp'), icon)
  const manifest = {
    id: appId,
    name: { en: 'Sample' },
    // Required — the consent card refuses to render a permission list with no purpose.
    description: { en: 'A builtin sample.' },
    version: '1.0.0',
    entry: 'index.html',
    icon: { path: 'icon.webp', sha256: crypto.createHash('sha256').update(icon).digest('hex') },
    permissions: [],
    network: []
  }
  await fs.promises.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return root
}

describe('builtin mini apps', () => {
  const dbh = setupTestDatabase()

  let work: string
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-builtin-'))
    // Same key-aware shape as installer.test, plus the builtin root — the chain cases
    // read `resources/<id>/` through it instead of injecting an explicit root.
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

  it('stages from a read-only directory without moving it', async () => {
    const root = await makeBuiltinPackage(APP_ID)
    const before = fs.readdirSync(root)

    await stageBuiltinMiniApp(APP_ID, root)

    // `publishInstall` RENAMES staging into place; handing it the resources directory
    // would delete the shipped package — and on macOS that tree is signed read-only.
    expect(fs.readdirSync(root)).toEqual(before)
  })

  it('refuses a builtin tree whose entry file is missing', async () => {
    // `copyTreeToStaging` runs the archive path's post-extraction validation; without
    // it a broken shipped tree still installs and dies only at first open.
    const root = await makeBuiltinPackage(APP_ID)
    fs.rmSync(path.join(root, 'index.html'))

    await expect(stageBuiltinMiniApp(APP_ID, root)).rejects.toThrow(/entry file is missing/i)
  })

  it('refuses a builtin tree whose entry is a directory', async () => {
    // The `isFile` half of the same gate — bare existence is satisfied by a DIRECTORY
    // named `index.html`, which installs and then 404s at first open.
    const root = await makeBuiltinPackage(APP_ID)
    fs.rmSync(path.join(root, 'index.html'))
    fs.mkdirSync(path.join(root, 'index.html'))

    await expect(stageBuiltinMiniApp(APP_ID, root)).rejects.toThrow(/not a regular file/i)
  })

  it('refuses a null sender before reading anything', async () => {
    // No package is even laid down: had the flow read first, this would be ENOENT.
    await expect(previewBuiltinForInstall(APP_ID, null)).rejects.toThrow(/managed window/i)
  })

  it('previews from resources with no copy, and stages only at confirm', async () => {
    // The chain the unit tests cannot see: preview → ledger → confirm as the handlers
    // drive it. A confirm branch quietly passing source 'file' would still be green there.
    await makeBuiltinPackage(APP_ID, path.join(work, 'builtin', APP_ID))

    const summary = await previewBuiltinForInstall(APP_ID, 'win-1')
    // Preview holds NO staging tree — that is design §10.2's whole point.
    expect(fs.existsSync(path.join(work, 'packages'))).toBe(false)
    expect(summary.iconDataUrl).toMatch(/^data:image\/webp;base64,/)

    await confirmPendingInstall(summary.installToken, 'win-1')

    const [install] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(install.source).toBe('builtin')
    expect(fs.readdirSync(path.join(work, 'packages')).filter((n) => n.startsWith('.staging-'))).toEqual([])
  })

  it('does not let another window confirm a builtin preview', async () => {
    await makeBuiltinPackage(APP_ID, path.join(work, 'builtin', APP_ID))
    const summary = await previewBuiltinForInstall(APP_ID, 'win-1')

    await expect(confirmPendingInstall(summary.installToken, 'win-2')).rejects.toThrow(/unknown or expired/i)
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
  })

  it('installs nothing until the staged tree is committed', async () => {
    // The hole this split exists to close: a one-call install grants everything the
    // manifest declares without the user ever having been shown the list.
    await stageBuiltinMiniApp(APP_ID, await makeBuiltinPackage(APP_ID))

    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
    expect(dbh.db.select().from(miniAppGrantTable).all()).toEqual([])
  })

  it('marks the row as official once the staged tree is committed', async () => {
    const staged = await stageBuiltinMiniApp(APP_ID, await makeBuiltinPackage(APP_ID))
    // Exactly what `install_confirmed` does with a registered snapshot.
    await installExtracted(staged.manifest, staged.stagingDir, { source: 'builtin' })

    const [row] = dbh.db.select().from(miniAppTable).all()
    // ONE predicate answers "is this official?", for sites and apps alike.
    expect(row.presetMiniAppId).toBe(APP_ID)
    const [install] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(install.source).toBe('builtin')
    // No manifest URL exists, so the three url-only columns must stay NULL or the
    // `mai_source_consistency` CHECK rejects the row.
    expect([install.sourceUrl, install.sourceOrigin, install.sourceOriginCn]).toEqual([null, null, null])
  })

  it('reports an update through the SAME check the url path uses', async () => {
    // Not a parallel status type: a builtin update runs the one review/apply/rollback
    // machine, so a permission the new tree added still stops it at `needs-consent`.
    const root = await makeBuiltinPackage(APP_ID)
    const staged = await stageBuiltinMiniApp(APP_ID, root)
    await installExtracted(staged.manifest, staged.stagingDir, { source: 'builtin' })
    expect(await checkForUpdate(APP_ID, root)).toEqual({ status: 'current' })

    // What a Cherry upgrade does: same path, different bytes.
    fs.writeFileSync(path.join(root, 'index.html'), '<html>v2</html>')

    expect(await checkForUpdate(APP_ID, root)).toMatchObject({ status: 'ready', updateToken: expect.any(String) })
  })

  it('refuses to COMMIT a builtin package outside the reserved prefix', async () => {
    // The namespace is what makes "official" mean anything. Staging may succeed — the gate
    // sits at the COMMIT, which is where the row would be written.
    const staged = await stageBuiltinMiniApp('com.example.notmine', await makeBuiltinPackage('com.example.notmine'))
    await expect(installExtracted(staged.manifest, staged.stagingDir, { source: 'builtin' })).rejects.toThrow(
      /must live under/i
    )
  })
})
