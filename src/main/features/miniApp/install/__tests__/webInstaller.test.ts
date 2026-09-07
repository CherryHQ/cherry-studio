import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HttpSourceModule from '../httpSource'
import type * as InstallerModule from '../installer'

const fetchManifest = vi.fn()
const fetchPackage = vi.fn()
const fetchIcon = vi.fn()
// `mirrorOrder` too: leaving it out makes it `undefined` at call time and every case
// here dies. Region order belongs to httpSource's own test; here it just has to exist.
// The pure helpers (`assertHttps`) stay real; only the three network calls are replaced.
vi.mock('../httpSource', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpSourceModule>()),
  fetchManifest,
  fetchPackage,
  fetchIcon,
  mirrorOrder: async (url: string, urlCn?: string) => (urlCn ? [url, urlCn] : [url])
}))
vi.mock('@main/services/entityLogo', () => ({ setInstalledMiniAppLogo: vi.fn().mockResolvedValue(undefined) }))
// The consent card's icon goes through the real transcoder; here the bytes just have to come back.
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: async (bytes: Uint8Array) => Buffer.from(bytes) }))
const notifyDataApiDataChange = vi.fn()
vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange }))
// Overridable per case, delegating to the real thing by default — one resource-recovery
// case needs staging creation itself to fail.
const createStagingDir = vi.fn()
vi.mock('../installer', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallerModule>()),
  createStagingDir: (...args: never[]) => createStagingDir(...args)
}))
const realInstaller = await vi.importActual<typeof InstallerModule>('../installer')

// `applyUpdate` / `rollbackUpdate` take the app offline first, so without the runtime
// service the WHOLE suite throws. `vi.hoisted` avoids the TDZ on first import.
const spy = vi.hoisted(() => ({ order: [] as string[] }))
// Loaded INSIDE the factory: a static import is not initialised when the hoisted mock runs.
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
      withAppQuiesced: vi.fn(async (appId: string, mutate: () => Promise<unknown>) => {
        spy.order.push(`quiesce:${appId}`)
        const result = await mutate()
        spy.order.push('mutate')
        return result
      }),
      recovered: Promise.resolve(new Set<string>()),
      clearUnrepaired: vi.fn(),
      forgetApp: vi.fn(),
      noteUpdateAvailable: vi.fn(),
      beginUpdate: vi.fn(),
      noteUpdateProgress: vi.fn(),
      endUpdate: vi.fn(),
      broadcastAttentionState: vi.fn()
    }
  })
})

vi.mock('../archive', () => ({
  // Materialize whatever the reviewed manifest described, so
  // `assertManifestMatchesReviewed` has a real packaged manifest to compare.
  extractMiniAppArchive: vi.fn(async (_zip: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, 'index.html'), packagedEntryHtml)
    // An icon the manifest declares must actually EXIST in the package, or the digest
    // check fails with ENOENT and the test proves nothing about digests.
    if (packagedIconBytes !== null) fs.writeFileSync(path.join(dest, 'icon.png'), packagedIconBytes)
    return packagedManifest
  })
}))

const { applyUpdate, checkForUpdate, previewMiniAppUrl, rollbackUpdate, REVIEW_TTL_MS } = await import(
  '../webInstaller'
)
const { confirmPendingInstall, previewUrlForInstall: previewUrlRaw } = await import('../installFlow')
type InstallPreviewSummary = Awaited<ReturnType<typeof previewUrlRaw>>
/** The install card — what every fresh-database case below gets; the install-over cases read the union. */
const asInstall = (p: InstallPreviewSummary) => {
  if (p.kind !== 'install') throw new Error(`expected an install preview, got ${p.kind}`)
  return p
}
const previewUrlForInstall = async (url: string, ownerId: string | null) => asInstall(await previewUrlRaw(url, ownerId))
const { pendingDeclaredAdditions } = await import('../../grants')

const APP_ID = 'com.example.mygame'
const ORIGIN = 'https://example.com'
const MANIFEST_URL = `${ORIGIN}/mygame/manifest.json`
const ORIGIN_CN = 'https://cdn.example.cn'
const MANIFEST_URL_CN = `${ORIGIN_CN}/mygame/manifest.json`

/** What the mocked extractor materializes — set by each test's `remote(...)`. */
let packagedManifest: Record<string, unknown>
/** Icon bytes the package actually ships, or null for a package with no icon. */
let packagedIconBytes: string | Uint8Array | null = null
/** The package's entry bytes. Mutable so one case can swap the FILE without touching
 *  the manifest — the only thing the tree hash can catch and the manifest check cannot. */
let packagedEntryHtml = '<h1>hi</h1>'

const sha256Of = (bytes: string | Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')
// REAL 1x1 PNGs, not stand-in strings: the icon path checks magic bytes before any decoder
// sees them, so a package can no longer name `icon.png` and ship SVG or HEIF.
const ICON_V1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC',
  'base64'
)
const ICON_V2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYPgPAAEDAQBdlO9aAAAAAElFTkSuQmCC',
  'base64'
)

const remote = (over: Record<string, unknown> = {}) => {
  packagedManifest = {
    id: APP_ID,
    name: 'My Game',
    description: 'A tiny sample game.',
    version: '1.1.0',
    entry: 'index.html',
    permissions: ['storage.get', 'storage.set'],
    // Present as the real (schema-parsed) `fetchManifest` result always has it.
    optionalPermissions: [],
    network: [],
    // BOTH endpoints, in both blocks: the schema and the `mai_source_consistency` CHECK
    // have required them since the dual-source gate landed.
    update: { url: MANIFEST_URL, urlCn: MANIFEST_URL_CN },
    package: {
      url: `${ORIGIN}/mygame/1.1.0.miniapp`,
      urlCn: `${ORIGIN_CN}/mygame/1.1.0.miniapp`,
      sha256: 'a'.repeat(64),
      size: 1024
    },
    ...over
  }
  return packagedManifest
}

describe('web install and update', () => {
  const dbh = setupTestDatabase()
  let root: string
  // Mirrors the registry: snapshots are a SIBLING of packages, not a child. Collapsing
  // them onto one directory here would hide exactly the collision the layout prevents.
  let packages: string
  let snapshots: string

  /**
   * A real staged file under a real scratch dir, disposed by the resource itself.
   * NEVER a bare path like '/tmp/x.miniapp': a bare path forces the caller to infer
   * what else it owns, and the obvious inference — "the parent directory is mine" —
   * is a recursive delete pointed at the system temp root.
   */
  const cleanups: Array<() => Promise<void>> = []
  const downloadedFixture = ({ iconBytes = null }: { iconBytes?: string | Uint8Array | null } = {}) => {
    // The extractor mock reads this — the "package contents" live there, not here.
    packagedIconBytes = iconBytes
    const dir = fs.mkdtempSync(path.join(root, 'dl-'))
    const file = path.join(dir, 'package.miniapp')
    fs.writeFileSync(file, 'zip')
    const cleanup = vi.fn(async () => {
      await fs.promises.rm(dir, { recursive: true, force: true })
    })
    cleanups.push(cleanup)
    return { path: file, cleanup }
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-web-'))
    packages = path.join(root, 'packages')
    snapshots = path.join(root, 'snapshots')
    fs.mkdirSync(packages)
    fs.mkdirSync(snapshots)
    cleanups.length = 0
    // Package contents are module-level and this file sets neither `clearMocks` nor
    // `restoreMocks`; without a reset one case's swapped bytes reach the next one.
    packagedIconBytes = null
    packagedEntryHtml = '<h1>hi</h1>'
    spy.order.length = 0
    // Module-level mocks, no `clearMocks`: "not called" assertions need a clean slate.
    fetchManifest.mockReset()
    fetchPackage.mockReset()
    fetchIcon.mockReset()
    createStagingDir.mockImplementation(realInstaller.createStagingDir)
    // Key-aware AND filename-aware: ignoring either collapses every journal onto
    // the packages root — `writeFileSync` on a directory.
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const roots: Record<string, string> = {
        'feature.mini_app.publish_journal': path.join(root, '.publish-journal'),
        'feature.mini_app.snapshots': snapshots,
        'feature.mini_app.packages': packages
      }
      const dir = roots[key] ?? root
      return filename ? path.join(dir, filename) : dir
    })
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    MockMainPreferenceServiceUtils.resetMocks()
  })

  const seedInstalled = async (
    over: {
      consentedDeclaredJson?: string[]
      icon?: { path: string; sha256: string }
      /** Lets a case seed a row whose stored endpoint is off-origin. */
      manifestUpdateUrl?: string
      /** Defaults to `manifestUpdateUrl` — the pair is required, never one alone. */
      manifestUpdateUrlCn?: string
      /** `'file'` and `'builtin'` drop the three url-only columns, as the CHECK requires. */
      source?: 'file' | 'url'
      /** What v1 declared. Defaults to the two leaves every case's grants are seeded from. */
      permissions?: string[]
    } = {}
  ) => {
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
        contentHash: 'sha256:old',
        ...(over.source === 'file'
          ? { source: 'file' as const, sourceUrl: null, sourceOrigin: null }
          : { source: 'url' as const, sourceUrl: MANIFEST_URL, sourceOrigin: ORIGIN, sourceOriginCn: ORIGIN_CN }),
        manifestJson: {
          id: APP_ID,
          name: 'My Game',
          description: 'A tiny sample game.',
          version: '1.0.0',
          entry: 'index.html',
          permissions: over.permissions ?? ['storage.get', 'storage.set'],
          optionalPermissions: [],
          network: [],
          ...(over.icon ? { icon: over.icon } : {}),
          ...(over.manifestUpdateUrl
            ? { update: { url: over.manifestUpdateUrl, urlCn: over.manifestUpdateUrlCn ?? over.manifestUpdateUrl } }
            : {})
        },
        consentedDeclaredJson: over.consentedDeclaredJson ?? ['storage.get', 'storage.set']
      })
      .run()
    // As a real install leaves it: the required leaves are GRANTED. Fixed at the two v1
    // leaves so a `storage.*` case can model a host that only had those two at consent time.
    for (const permission of ['storage.get', 'storage.set']) {
      dbh.db.insert(miniAppGrantTable).values({ appId: APP_ID, permission, grantedVersion: '1.0.0' }).run()
    }
    // An installed app has FILES as well as rows — an update renames the tree away,
    // and `rename` on a missing source fails before any of the logic under test runs.
    fs.mkdirSync(path.join(packages, APP_ID), { recursive: true })
    fs.writeFileSync(path.join(packages, APP_ID, 'index.html'), '<h1>old</h1>')
    // A real install records the hash of the tree it published, and rollback checks the
    // retained tree against it. A placeholder here would make every rollback case pass
    // against a snapshot nobody verified.
    const contentHash = await realInstaller.hashTree(path.join(packages, APP_ID))
    dbh.db.update(miniAppInstallationTable).set({ contentHash }).where(eq(miniAppInstallationTable.appId, APP_ID)).run()
    return contentHash
  }

  const grantsOf = () =>
    dbh.db
      .select()
      .from(miniAppGrantTable)
      .where(eq(miniAppGrantTable.appId, APP_ID))
      .all()
      .map((g) => g.permission)
      .sort()

  it('reports current when the remote version matches', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))
    expect(await checkForUpdate(APP_ID)).toMatchObject({ status: 'current' })
  })

  it('shares one in-flight check between concurrent callers', async () => {
    // Every open fires a check; while a server hangs, reopening must not stack requests.
    await seedInstalled()
    let answer: (value: unknown) => void = () => undefined
    fetchManifest.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const first = checkForUpdate(APP_ID)
    const second = checkForUpdate(APP_ID)
    answer(remote({ version: '1.0.0' }))
    expect(await Promise.all([first, second])).toEqual([{ status: 'current' }, { status: 'current' }])
    expect(fetchManifest).toHaveBeenCalledTimes(1)

    fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))
    await checkForUpdate(APP_ID)
    expect(fetchManifest).toHaveBeenCalledTimes(2)
  })

  it('reports ready when the declared set is unchanged', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    expect(await checkForUpdate(APP_ID)).toMatchObject({ status: 'ready', version: '1.1.0' })
  })

  it('requires consent when a capability is added', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    expect(await checkForUpdate(APP_ID)).toMatchObject({ status: 'needs-consent', added: ['ai.chat'] })
  })

  it('requires consent when a network domain is added', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ network: ['evil.com'] }))
    // Hosts are not grants, but an ADDED host still has to stop the update: this is the
    // one check standing between a compromised update server and silent exfiltration.
    expect(await checkForUpdate(APP_ID)).toMatchObject({ status: 'needs-consent', addedHosts: ['evil.com'] })
  })

  it('refuses a manifest served from a different origin', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(
      remote({ update: { url: 'https://attacker.io/m.json', urlCn: 'https://attacker.cn/m.json' } })
    )
    await expect(checkForUpdate(APP_ID)).rejects.toThrow(/origin/i)
  })

  it('never applies an update as a side effect of checking', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    await checkForUpdate(APP_ID)
    expect(fetchPackage).not.toHaveBeenCalled()
  })

  it('still reports an update when the on-open check is disabled', async () => {
    // The preference gates the on-open check only. A manual check must always work,
    // or turning it off would also disable the button the user just pressed.
    await seedInstalled()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.check_updates_on_open', false)
    fetchManifest.mockResolvedValue(remote())
    expect(await checkForUpdate(APP_ID)).toMatchObject({ status: 'ready', version: '1.1.0' })
  })

  it('refuses to apply an update that needs consent without it', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken! })).rejects.toThrow(/consent/i)
  })

  it('refuses to apply without a token — consent alone is not a mandate', async () => {
    // The bug this guards: re-fetching the manifest at apply time lets the server swap
    // the payload, so "yes to 1.1.0 + ai" becomes "yes to whatever ships next".
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    await expect(applyUpdate(APP_ID, { consented: true } as never)).rejects.toThrow(/token/i)
  })

  it('refuses a token that was already spent', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })
    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken! })).rejects.toThrow(/token/i)
  })

  it('grants a newly offered optional leaf unless the user unticked it', async () => {
    // Same model as install: offered optional leaves start on. Two tokens because apply
    // spends one, and the default and the explicit choice must both be observed.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ optionalPermissions: ['notification.show'] }))
    const offered = await checkForUpdate(APP_ID)
    expect(offered).toMatchObject({ status: 'ready', addedOptional: ['notification.show'] })
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: offered.updateToken!, grantedOptional: [] })
    expect(
      dbh.db
        .select()
        .from(miniAppGrantTable)
        .all()
        .map((row) => row.permission)
    ).not.toContain('notification.show')

    // Back to 1.0.0 and forward again, this time with the default.
    await rollbackUpdate(APP_ID)
    const again = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: again.updateToken! })
    expect(
      dbh.db
        .select()
        .from(miniAppGrantTable)
        .all()
        .map((row) => row.permission)
    ).toContain('notification.show')
  })

  it('refuses a token issued for a different app', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)

    await expect(applyUpdate('com.example.other', { updateToken: checked.updateToken! })).rejects.toThrow(/token/i)
  })

  it('downloads exactly the package the reviewed manifest named', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    expect(fetchPackage).toHaveBeenCalledWith(
      expect.arrayContaining([`${ORIGIN}/mygame/1.1.0.miniapp`, `${ORIGIN_CN}/mygame/1.1.0.miniapp`]),
      expect.objectContaining({
        sha256: 'a'.repeat(64),
        size: 1024,
        origins: expect.arrayContaining([ORIGIN, ORIGIN_CN])
      }),
      expect.any(Function)
    )
  })

  it('applies an update that needs consent once consented', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.version).toBe('1.1.0')
    expect(grantsOf()).toEqual(['ai.chat', 'storage.get'])
  })

  it('restores the grants the user actually held, not the ones the old manifest declared', async () => {
    // The bug this guards: rebuilding grants from `previousManifestJson` hands back a
    // permission the user revoked.
    await seedInstalled()
    // The user revoked `storage.get` before the update; `storage.set` they kept.
    dbh.db.delete(miniAppGrantTable).where(eq(miniAppGrantTable.permission, 'storage.get')).run()

    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })
    expect(grantsOf()).toEqual(['ai.chat'])

    await rollbackUpdate(APP_ID)

    // The snapshot, not the old manifest: `storage.get` stays revoked, `storage.set` comes back.
    expect(grantsOf()).toEqual(['storage.set'])
  })

  it('installs from a manifest with no accelerator and pins a single origin', async () => {
    // `urlCn` is optional for third-party authors. The row then holds one origin, and the
    // CHECK that used to demand a China origin for every url install must let it through.
    fetchManifest.mockResolvedValue(
      remote({
        update: { url: MANIFEST_URL },
        package: { url: `${ORIGIN}/mygame/1.1.0.miniapp`, sha256: 'a'.repeat(64), size: 1024 }
      })
    )
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    fetchPackage.mockResolvedValue(downloadedFixture())

    await confirmPendingInstall(preview.installToken, 'win-1')

    const [row] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(row).toMatchObject({ source: 'url', sourceOrigin: ORIGIN, sourceOriginCn: null })
  })

  it('cleans up the download when staging cannot even be created', async () => {
    // The escape: `createStagingDir()` runs between the fetch and the try — a throw
    // there must not strand the temp file for good.
    fetchManifest.mockResolvedValue(remote())
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    const pkg = downloadedFixture()
    fetchPackage.mockResolvedValue(pkg)
    createStagingDir.mockRejectedValueOnce(new Error('ENOSPC'))

    await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/ENOSPC/)

    expect(pkg.cleanup).toHaveBeenCalledTimes(1)
  })

  it('a failed download cleanup does not mask a committed install', async () => {
    fetchManifest.mockResolvedValue(remote())
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    const pkg = downloadedFixture()
    pkg.cleanup.mockRejectedValueOnce(new Error('EBUSY'))
    fetchPackage.mockResolvedValue(pkg)

    // "Errored UI over an app that actually installed" is the state this forbids.
    await expect(confirmPendingInstall(preview.installToken, 'win-1')).resolves.toMatchObject({ appId: APP_ID })
  })

  it('keeps the original failure when cleanup also fails', async () => {
    fetchManifest.mockResolvedValue(remote())
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    const pkg = downloadedFixture()
    pkg.cleanup.mockRejectedValueOnce(new Error('EBUSY'))
    fetchPackage.mockResolvedValue(pkg)
    createStagingDir.mockRejectedValueOnce(new Error('ENOSPC'))

    // Staging refused, so the install fails — and EBUSY must not replace that story.
    await expect(confirmPendingInstall(preview.installToken, 'win-1')).rejects.toThrow(/ENOSPC/)
  })

  it('a failed staging removal neither masks the install nor skips the download cleanup', async () => {
    fetchManifest.mockResolvedValue(remote())
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    const pkg = downloadedFixture()
    fetchPackage.mockResolvedValue(pkg)
    // Aimed at the STAGING tree by path — see the same case in `installFlow.test.ts`.
    const realRm = fs.promises.rm
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, options) =>
        String(target).includes('.staging-') ? Promise.reject(new Error('EPERM')) : realRm(target, options)
      )
    try {
      // Cleanup trouble is a leak to LOG — the committed install must still resolve.
      await expect(confirmPendingInstall(preview.installToken, 'win-1')).resolves.toMatchObject({ appId: APP_ID })
    } finally {
      rm.mockRestore()
    }
    expect(pkg.cleanup).toHaveBeenCalledTimes(1)
  })

  it('publishes a /mini-apps projection change after an applied update and a rollback', async () => {
    // Both rewrite name/version/url on an EXISTING row — IpcApi writes DataApi never
    // sees, so this signal is what refreshes the launcher's stale projection.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    notifyDataApiDataChange.mockClear()

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })
    expect(notifyDataApiDataChange).toHaveBeenCalledWith([{ endpoint: '/mini-apps', kind: 'projection' }])

    notifyDataApiDataChange.mockClear()
    await rollbackUpdate(APP_ID)
    expect(notifyDataApiDataChange).toHaveBeenCalledWith([{ endpoint: '/mini-apps', kind: 'projection' }])
  })

  it('publishes nothing when the update stops at needs-consent', async () => {
    // Refusal is not a commit: a signal here would refetch a list that did not change.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    notifyDataApiDataChange.mockClear()

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken! })).rejects.toThrow(/consent/i)

    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('disposes the download through the resource, never by deleting its parent', async () => {
    // The bug this guards: a caller computing `path.dirname(...)` of a returned file
    // recursively deleted /tmp. Ownership belongs to the resource, not the caller.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    const pkg = downloadedFixture()
    fetchPackage.mockResolvedValue(pkg)

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    expect(pkg.cleanup).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(root)).toBe(true)
  })

  it('pins the origin the user installed from', async () => {
    fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    fetchPackage.mockResolvedValue(downloadedFixture())

    await confirmPendingInstall(preview.installToken, 'win-1')

    const [row] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(row).toMatchObject({ source: 'url', sourceUrl: MANIFEST_URL, sourceOrigin: ORIGIN })
  })

  it('refuses a packaged manifest whose update endpoint left the pinned origin', async () => {
    // The hole this closes: `update` was not compared, so a package could point the
    // NEXT check at another origin — and omitting `update` fell back and passed.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    const checked = await checkForUpdate(APP_ID)
    packagedManifest = {
      ...remote({ version: '1.1.0' }),
      update: { url: 'https://evil.com/m.json', urlCn: 'https://evil.cn/m.json' }
    }
    fetchPackage.mockResolvedValue(downloadedFixture())

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })).rejects.toThrow(
      /does not match|reviewed/i
    )
  })

  it('never requests an off-origin endpoint, even one already stored', async () => {
    // Defence in depth: the check must refuse BEFORE fetching. Asserting on the throw
    // alone passes for a version that fetches first and validates after.
    await seedInstalled({ manifestUpdateUrl: 'https://evil.com/m.json' })
    fetchManifest.mockClear()

    await expect(checkForUpdate(APP_ID)).rejects.toThrow(/left its origin/i)

    expect(fetchManifest).not.toHaveBeenCalled()
  })

  it('follows an endpoint the new version moved, and unfollows it on rollback', async () => {
    // Three DIFFERENT urls on purpose — install link, v1 endpoint, v2 endpoint. With a
    // stored `sourceUrl` they collapse into one and the bug is invisible.
    const V1_ENDPOINT = `${ORIGIN}/mygame/manifest.json`
    const V2_ENDPOINT = `${ORIGIN}/mygame/v2/manifest.json`
    const V1_ENDPOINT_CN = `${ORIGIN_CN}/mygame/v1/manifest.json`
    const V2_ENDPOINT_CN = `${ORIGIN_CN}/mygame/v2/manifest.json`
    const INSTALL_URL = `${ORIGIN}/mygame/install-once.json`

    fetchManifest.mockResolvedValue(remote({ version: '1.0.0', update: { url: V1_ENDPOINT, urlCn: V1_ENDPOINT_CN } }))
    const preview = await previewUrlForInstall(INSTALL_URL, 'win-1')
    fetchPackage.mockResolvedValue(downloadedFixture())
    await confirmPendingInstall(preview.installToken, 'win-1')

    fetchManifest.mockClear()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', update: { url: V2_ENDPOINT, urlCn: V2_ENDPOINT_CN } }))
    const checked = await checkForUpdate(APP_ID)
    expect(fetchManifest).toHaveBeenCalledWith(expect.arrayContaining([V1_ENDPOINT]))

    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })
    fetchManifest.mockClear()
    await checkForUpdate(APP_ID).catch(() => undefined)
    expect(fetchManifest).toHaveBeenCalledWith(expect.arrayContaining([V2_ENDPOINT]))

    await rollbackUpdate(APP_ID)
    fetchManifest.mockClear()
    await checkForUpdate(APP_ID).catch(() => undefined)
    expect(fetchManifest).toHaveBeenCalledWith(expect.arrayContaining([V1_ENDPOINT]))
  })

  it('refuses to download a package hosted on another origin', async () => {
    // The bug this guards: pinning only `update.url` guards the pointer, not the
    // payload — a source pinned to example.com could still ship attacker.io bytes.
    await seedInstalled()
    fetchManifest.mockResolvedValue(
      remote({
        package: {
          url: 'https://attacker.io/p.miniapp',
          urlCn: 'https://attacker.cn/p.miniapp',
          sha256: 'a'.repeat(64),
          size: 1024
        }
      })
    )

    // Fail-fast at CHECK time: no token is issued for a payload off the pinned origins, so
    // nothing ever reaches the download. (`fetchPackage` keeps its own pin as a second layer.)
    await expect(checkForUpdate(APP_ID)).rejects.toThrow(/declared origin/i)
    expect(fetchPackage).not.toHaveBeenCalled()
  })

  it('surfaces a rename in the update preview', async () => {
    // The bug this guards: a silent rename in a routine update. Combined with the
    // notification grant it is a phishing primitive, and the user never saw it.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ name: 'Cherry Studio' }))

    expect(await checkForUpdate(APP_ID)).toMatchObject({
      identityChange: { name: { from: 'My Game', to: 'Cherry Studio' } }
    })
  })

  it('surfaces a rename that only happens in a locale the user is not reading', async () => {
    // The bug this guards: diffing resolved strings. An English reader would see no
    // change while every Chinese user's list now says "Cherry Studio".
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ name: { en: 'My Game', zh: 'Cherry Studio' } }))

    expect(await checkForUpdate(APP_ID)).toMatchObject({ identityChange: { name: expect.anything() } })
  })

  it('refuses a package whose manifest renames the app behind the preview', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    packagedManifest = { ...packagedManifest, name: 'Cherry Studio' }
    fetchPackage.mockResolvedValue(downloadedFixture())

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken! })).rejects.toThrow(/does not match/i)
  })

  it('leaves the current version and its retained backup alone when a LATER update is refused', async () => {
    // The bug this guards: compensating on "`.backup` exists". After one successful
    // update `.backup` is the RETAINED previous version, so a refusal before any tree
    // moved would delete the current tree and rename v1 under rows that still say v2.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    const toV2 = await checkForUpdate(APP_ID)
    packagedEntryHtml = '<h1>v2</h1>'
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: toV2.updateToken! })

    fetchManifest.mockResolvedValue(remote({ version: '1.2.0' }))
    const toV3 = await checkForUpdate(APP_ID)
    packagedManifest = { ...packagedManifest, name: 'Cherry Studio' }
    packagedEntryHtml = '<h1>v3</h1>'
    fetchPackage.mockResolvedValue(downloadedFixture())
    await expect(applyUpdate(APP_ID, { updateToken: toV3.updateToken! })).rejects.toThrow(/does not match/i)

    expect(fs.readFileSync(path.join(packages, APP_ID, 'index.html'), 'utf8')).toBe('<h1>v2</h1>')
    expect(fs.readFileSync(path.join(snapshots, `${APP_ID}.backup`, 'index.html'), 'utf8')).toBe('<h1>old</h1>')
    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.version).toBe('1.1.0')
    // The retained version is still usable — the records still promise it.
    await expect(rollbackUpdate(APP_ID)).resolves.toBeUndefined()
    expect(fs.readFileSync(path.join(packages, APP_ID, 'index.html'), 'utf8')).toBe('<h1>old</h1>')
  })

  it('refuses a manifest that points its own updates at another origin', async () => {
    // Otherwise the pin is set to a value the very first update escapes.
    fetchManifest.mockResolvedValue(
      remote({ version: '1.0.0', update: { url: 'https://attacker.io/m.json', urlCn: 'https://attacker.cn/m.json' } })
    )

    await expect(previewMiniAppUrl(MANIFEST_URL)).rejects.toThrow(/origin/i)
    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(0)
  })

  it('does not accumulate tokens the on-open check never consumes', async () => {
    // The bug this guards: `expiresAt` gates validity but nothing gates lifetime, so
    // every app-open leaks an entry for the life of the process.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const first = await checkForUpdate(APP_ID)

    // Only `Date` is faked: a bare `setSystemTime` swaps in a FROZEN clock for the rest
    // of the file, and nothing here waits on a timer.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + REVIEW_TTL_MS + 1000)
      await checkForUpdate(APP_ID)

      // "Unknown", not "expired": an expired-but-retained token is the leak itself.
      await expect(applyUpdate(APP_ID, { updateToken: first.updateToken! })).rejects.toThrow(
        /unknown or already-spent/i
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a token whose baseline no longer matches the installed version', async () => {
    // The bug this guards: two tokens issued at v1. Applying the second replays a
    // v1-relative diff onto v2.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const first = await checkForUpdate(APP_ID)
    const second = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: first.updateToken! })
    fetchPackage.mockResolvedValue(downloadedFixture())

    await expect(applyUpdate(APP_ID, { updateToken: second.updateToken! })).rejects.toThrow(/issued against/i)
  })

  it('serializes two applies of the same app', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const a = await checkForUpdate(APP_ID)
    const b = await checkForUpdate(APP_ID)
    fetchPackage.mockImplementation(async () => downloadedFixture())

    const results = await Promise.allSettled([
      applyUpdate(APP_ID, { updateToken: a.updateToken! }),
      applyUpdate(APP_ID, { updateToken: b.updateToken! })
    ])

    // Whichever loses the race fails the baseline check rather than interleaving
    // renames with the winner.
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  it('sets the current tree aside so an interrupted rollback can be undone', async () => {
    // The bug this guards: journalling a rollback as `update`. `.backup` is already
    // consumed, so the repair restores nothing.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    await rollbackUpdate(APP_ID)

    expect(fs.existsSync(path.join(snapshots, `${APP_ID}.rolling`))).toBe(false)
    expect(fs.existsSync(path.join(snapshots, `${APP_ID}.backup`))).toBe(false)
  })

  it('refuses to publish a snapshot whose contents no longer match the record', async () => {
    // The bug this guards: rollback treated "a directory is there" as proof it holds the
    // recorded previous version. The snapshot path is derived from the appId, so anything
    // that writes to that path — a bug, a restored backup, a hand-edit — would be
    // published under this app's identity, version and grants.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    fs.writeFileSync(path.join(snapshots, `${APP_ID}.backup`, 'index.html'), '<h1>not what was recorded</h1>')

    await expect(rollbackUpdate(APP_ID)).rejects.toThrow(/does not match/i)
    // Still on the version the records describe, with the snapshot left for inspection.
    expect(fs.readFileSync(path.join(packages, APP_ID, 'index.html'), 'utf8')).toBe(packagedEntryHtml)
    expect(fs.existsSync(path.join(snapshots, `${APP_ID}.backup`))).toBe(true)
  })

  it('restores the current tree when a rollback fails midway', async () => {
    // The bug this guards: with no compensation the RUNNING process serves from a
    // missing directory until restart — not a recovery story for a button press.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote())
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    // Fail the DB commit, not a rename: that is the window where both renames landed,
    // `.backup` is consumed, and naive compensation deletes what it should restore.
    // `withWriteTx` is already a `vi.fn` on the unified mock: a one-shot implementation
    // needs no spy and no restore (restoring a spy over it leaves a non-mock behind).
    vi.mocked(application.get('DbService').withWriteTx).mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })

    await expect(rollbackUpdate(APP_ID)).rejects.toThrow('SQLITE_BUSY')

    expect(fs.existsSync(path.join(packages, APP_ID))).toBe(true)
    expect(fs.existsSync(path.join(snapshots, `${APP_ID}.rolling`))).toBe(false)
    // The retained version must still be retained — the records still promise it.
    expect(fs.existsSync(path.join(snapshots, `${APP_ID}.backup`))).toBe(true)
    await expect(rollbackUpdate(APP_ID)).resolves.toBeUndefined()
  })

  it('rolls version, manifest and grants back together', async () => {
    // Seeded as a real install leaves it: every v1 required leaf granted, so the snapshot
    // taken at update time is `['storage.get', 'storage.set']` and the rollback must restore both.
    const v1Hash = await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    await rollbackUpdate(APP_ID)

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.version).toBe('1.0.0')
    expect(row.contentHash).toBe(v1Hash)
    expect(grantsOf()).toEqual(['storage.get', 'storage.set'])
  })

  it('does not treat a host-added leaf as consented just because a version shipped', async () => {
    // The bug this guards: writing the NEW manifest's full expansion here. An ordinary
    // version bump would mark a later-added leaf consented, and the prompt never fires.
    // v1 declared `storage.*` when the host only had two leaves; both versions still say
    // `storage.*`, so the diff adds nothing and the baseline may not grow on its own.
    await seedInstalled({ permissions: ['storage.*'], consentedDeclaredJson: ['storage.get', 'storage.set'] })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', permissions: ['storage.*'] }))
    const checked = await checkForUpdate(APP_ID)
    expect(checked).toMatchObject({ status: 'ready' })
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.consentedDeclaredJson).toEqual(['storage.get', 'storage.set'])
    // The host-added leaves are still PENDING — the prompt the baseline exists to keep alive.
    expect(pendingDeclaredAdditions(APP_ID, row.manifestJson, row.consentedDeclaredJson)).toEqual([
      'storage.delete',
      'storage.keys'
    ])
  })

  it('extends the consent baseline by exactly what the user just agreed to', async () => {
    // The mirror: consent must still GROW when a human actually said yes, or the
    // prompt would come back forever.
    await seedInstalled({ consentedDeclaredJson: ['storage.get'] })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())

    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.consentedDeclaredJson).toEqual(['ai.chat', 'storage.get'])
  })

  it('restores the consent baseline on rollback', async () => {
    // The bug this guards: rolling back everything but `consentedDeclaredJson` — a
    // leaf stays "consented" for a version that no longer exists.
    await seedInstalled({ consentedDeclaredJson: ['storage.get'] })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', permissions: ['storage.get', 'ai.chat'] }))
    const checked = await checkForUpdate(APP_ID)
    fetchPackage.mockResolvedValue(downloadedFixture())
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    await rollbackUpdate(APP_ID)

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.consentedDeclaredJson).toEqual(['storage.get'])
  })

  it('takes the app offline before applying an update', async () => {
    // Asserts ORDER, not just "was called": a wrapper that mutates first and quiesces
    // after satisfies `toHaveBeenCalled`, and a missing one is invisible elsewhere.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    fetchPackage.mockResolvedValue(downloadedFixture())
    const checked = await checkForUpdate(APP_ID)
    spy.order.length = 0

    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    expect(spy.order).toEqual([`quiesce:${APP_ID}`, 'mutate'])
  })

  it('lights the badge when a manual check finds a version, and clears it when it does not', async () => {
    // The bug this guards: wiring only the on-open check, so a manual check sets no
    // dot and an app that went current keeps one.
    await seedInstalled()
    const runtime = application.get('MiniAppRuntimeService')

    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    await checkForUpdate(APP_ID)
    expect(runtime.noteUpdateAvailable).toHaveBeenLastCalledWith(APP_ID, '1.1.0')

    fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))
    await checkForUpdate(APP_ID)
    expect(runtime.noteUpdateAvailable).toHaveBeenLastCalledWith(APP_ID, null)
  })

  it('marks the app as updating for the whole apply, reporting download progress', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    fetchPackage.mockImplementation(
      async (_urls: string[], _expected: unknown, onProgress?: (r: number, t: number) => void) => {
        onProgress?.(512, 1024)
        return downloadedFixture()
      }
    )
    const runtime = application.get('MiniAppRuntimeService')
    const checked = await checkForUpdate(APP_ID)

    await applyUpdate(APP_ID, { updateToken: checked.updateToken! })

    expect(runtime.beginUpdate).toHaveBeenCalledWith(APP_ID, '1.1.0')
    expect(runtime.noteUpdateProgress).toHaveBeenCalledWith(APP_ID, 0.5)
    expect(runtime.endUpdate).toHaveBeenCalledWith(APP_ID)
  })

  it('refuses a second apply while one is in flight, before any download, and always ends the update', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    const runtime = application.get('MiniAppRuntimeService')
    const checked = await checkForUpdate(APP_ID)
    vi.mocked(runtime.beginUpdate).mockImplementationOnce(() => {
      throw new Error(`Mini app ${APP_ID} is already being updated`)
    })

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken! })).rejects.toThrow(/already being updated/i)
    expect(fetchPackage).not.toHaveBeenCalled()

    // A failed download still ends the "updating" state, or the tile spins for ever.
    const again = await checkForUpdate(APP_ID)
    vi.mocked(runtime.endUpdate).mockClear()
    fetchPackage.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(applyUpdate(APP_ID, { updateToken: again.updateToken! })).rejects.toThrow(/ECONNRESET/)
    expect(runtime.endUpdate).toHaveBeenCalledWith(APP_ID)
  })

  it('clears the attention badge after an update is applied', async () => {
    // The bug this guards: a badge that only ever gets SET. If apply never clears it,
    // the dot stays lit on an up-to-date app and nobody trusts the dot.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    fetchPackage.mockResolvedValue(downloadedFixture())
    const checked = await checkForUpdate(APP_ID)
    const runtime = application.get('MiniAppRuntimeService')
    vi.mocked(runtime.noteUpdateAvailable).mockClear()

    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    expect(runtime.noteUpdateAvailable).toHaveBeenCalledWith(APP_ID, null)
  })

  it('clears it after a rollback too', async () => {
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    fetchPackage.mockResolvedValue(downloadedFixture())
    const checked = await checkForUpdate(APP_ID)
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })
    const runtime = application.get('MiniAppRuntimeService')
    vi.mocked(runtime.noteUpdateAvailable).mockClear()

    await rollbackUpdate(APP_ID)

    expect(runtime.noteUpdateAvailable).toHaveBeenCalledWith(APP_ID, null)
  })

  it('takes the app offline before rolling back', async () => {
    // Rollback needs something to roll back TO: with no committed update there are no
    // `previous*` columns, and the call fails before reaching the wrapper.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))
    fetchPackage.mockResolvedValue(downloadedFixture())
    const checked = await checkForUpdate(APP_ID)
    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })
    spy.order.length = 0

    await rollbackUpdate(APP_ID)

    expect(spy.order).toEqual([`quiesce:${APP_ID}`, 'mutate'])
  })

  it('surfaces a same-path icon swap at CHECK time, from the digest', async () => {
    // The bug this guards: comparing the icon PATH. `icon.png -> icon.png` with new
    // bytes is the ordinary way to change a face, and the same primitive as a rename.
    await seedInstalled({ icon: { path: 'icon.png', sha256: 'a'.repeat(64) } })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', icon: { path: 'icon.png', sha256: 'b'.repeat(64) } }))

    const checked = await checkForUpdate(APP_ID)

    expect(checked.identityChange?.icon).toEqual({ from: 'icon.png', to: 'icon.png' })
  })

  it('reports no icon change when the digest is unchanged', async () => {
    // The mirror. Without it the previous case passes for a version that flags every
    // update as an icon change, which is the same as flagging none.
    const icon = { path: 'icon.png', sha256: 'a'.repeat(64) }
    await seedInstalled({ icon })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', icon }))

    const checked = await checkForUpdate(APP_ID)

    expect(checked.identityChange?.icon).toBeUndefined()
  })

  it('refuses a package whose icon bytes do not match the digest its manifest declares', async () => {
    // What makes the digest trustworthy: without it a manifest can claim any digest and
    // ship a different face — the same hole, one layer up.
    const icon = { path: 'icon.png', sha256: sha256Of(ICON_V2) }
    await seedInstalled({ icon: { path: 'icon.png', sha256: sha256Of(ICON_V1) } })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', icon }))
    fetchPackage.mockResolvedValue(downloadedFixture({ iconBytes: 'not-what-the-digest-says' }))
    const checked = await checkForUpdate(APP_ID)

    await expect(applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })).rejects.toThrow(
      /does not match the digest/i
    )
    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.version).toBe('1.0.0') // nothing committed
  })

  it('applies a disclosed icon change without a second confirmation', async () => {
    // The regression this guards is a DEADLOCK: comparing bytes at apply time aborts
    // with "check again", and the re-check reports "no change". Digests are real.
    const icon = { path: 'icon.png', sha256: sha256Of(ICON_V2) }
    await seedInstalled({ icon: { path: 'icon.png', sha256: sha256Of(ICON_V1) } })
    fetchManifest.mockResolvedValue(remote({ version: '1.1.0', icon }))
    fetchPackage.mockResolvedValue(downloadedFixture({ iconBytes: ICON_V2 }))
    const checked = await checkForUpdate(APP_ID)
    expect(checked.identityChange?.icon).toBeDefined()

    await applyUpdate(APP_ID, { updateToken: checked.updateToken!, consented: true })

    const [row] = dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()
    expect(row.version).toBe('1.1.0')
  })

  it.each([
    ['a lower remote version', '0.9.0'],
    ['the same version with different bytes', '1.0.0']
  ])('reports current for %s', async (_name, version) => {
    // `!==` accepts the downgrade, and a string compare puts 1.10.0 below 1.9.0.
    // Same-version-new-bytes is current on purpose — not bumping is saying nothing changed.
    await seedInstalled()
    fetchManifest.mockResolvedValue(remote({ version }))

    await expect(checkForUpdate(APP_ID)).resolves.toEqual({ status: 'current' })
  })

  it('refuses an update that changes the pinned origins', async () => {
    // Adding a mirror is as much a supply-chain move as replacing one: whoever controls
    // the endpoint could otherwise walk the app onto a host the user never approved.
    await seedInstalled()
    fetchManifest.mockResolvedValue(
      remote({ version: '1.1.0', update: { url: MANIFEST_URL, urlCn: 'https://evil.cn/m.json' } })
    )

    await expect(checkForUpdate(APP_ID)).rejects.toThrow(/origins changed/i)
  })

  it('shows the declared capabilities before anything is downloaded', async () => {
    // A wildcard must be shown EXPANDED: `storage.*` on a consent card tells the user
    // nothing, and leaf permissions exist so the list can be read.
    fetchManifest.mockResolvedValue(remote({ version: '1.0.0', permissions: ['storage.*', 'ai.chat'] }))

    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')

    expect(preview.required).toEqual(['ai.chat', 'storage.delete', 'storage.get', 'storage.keys', 'storage.set'])
    expect(preview.optional).toEqual([])
    expect(fetchPackage).not.toHaveBeenCalled()
  })

  it('shows the icon the distribution manifest points at, before any package downloads', async () => {
    fetchManifest.mockResolvedValue(
      remote({
        icon: { path: 'icon.png', sha256: sha256Of(ICON_V1) },
        package: {
          url: `${ORIGIN}/mygame/1.1.0.miniapp`,
          iconUrl: `${ORIGIN}/mygame/icon.png`,
          sha256: 'a'.repeat(64),
          size: 1024
        },
        update: { url: MANIFEST_URL }
      })
    )
    fetchIcon.mockResolvedValue(Buffer.from(ICON_V1))

    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')

    expect(preview.iconDataUrl).toMatch(/^data:image\/webp;base64,/)
    // Verified against the manifest's own digest, on a pinned origin — never a free fetch.
    expect(fetchIcon).toHaveBeenCalledWith(`${ORIGIN}/mygame/icon.png`, {
      sha256: sha256Of(ICON_V1),
      origins: [ORIGIN]
    })
    expect(fetchPackage).not.toHaveBeenCalled()
  })

  it('shows the placeholder, not an error, when the icon cannot be fetched or does not verify', async () => {
    // Decoration, not a gate: the card must still open and the install must still work.
    fetchManifest.mockResolvedValue(
      remote({
        icon: { path: 'icon.png', sha256: sha256Of(ICON_V1) },
        package: {
          url: `${ORIGIN}/mygame/1.1.0.miniapp`,
          iconUrl: `${ORIGIN}/mygame/icon.png`,
          sha256: 'a'.repeat(64),
          size: 1024
        },
        update: { url: MANIFEST_URL }
      })
    )
    fetchIcon.mockRejectedValue(new Error('Icon hash mismatch'))

    await expect(previewUrlForInstall(MANIFEST_URL, 'win-1')).resolves.toMatchObject({ iconDataUrl: null })
  })

  it('refuses an icon url off the declared origins before fetching anything', async () => {
    fetchManifest.mockResolvedValue(
      remote({
        icon: { path: 'icon.png', sha256: sha256Of(ICON_V1) },
        package: {
          url: `${ORIGIN}/mygame/1.1.0.miniapp`,
          iconUrl: 'https://evil.example/icon.png',
          sha256: 'a'.repeat(64),
          size: 1024
        },
        update: { url: MANIFEST_URL }
      })
    )

    await expect(previewUrlForInstall(MANIFEST_URL, 'win-1')).rejects.toThrow(/icon url .* declared origin/i)
    expect(fetchIcon).not.toHaveBeenCalled()
  })

  it('falls back to <address>/manifest.json and records the address that answered', async () => {
    // The file may be called anything and a directory address is the common case; the
    // conventional name is tried second, and the pin is checked against what answered.
    fetchManifest.mockRejectedValueOnce(new Error('Failed to fetch mini app manifest: 404'))
    fetchManifest.mockResolvedValueOnce(
      remote({
        version: '1.0.0',
        update: { url: `${ORIGIN}/mygame/manifest.json` },
        package: { url: `${ORIGIN}/mygame/1.0.0.miniapp`, sha256: 'a'.repeat(64), size: 1024 }
      })
    )

    const preview = await previewUrlForInstall(`${ORIGIN}/mygame/`, 'win-1')
    fetchPackage.mockResolvedValue(downloadedFixture())
    await confirmPendingInstall(preview.installToken, 'win-1')

    expect(fetchManifest.mock.calls.map(([urls]) => urls)).toEqual([
      [`${ORIGIN}/mygame/`],
      [`${ORIGIN}/mygame/manifest.json`]
    ])
    const [row] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(row.sourceUrl).toBe(`${ORIGIN}/mygame/manifest.json`)
  })

  it('names both addresses when neither is a manifest, and does not retry one that already names manifest.json', async () => {
    fetchManifest.mockRejectedValue(new Error('Failed to fetch mini app manifest: 404'))

    await expect(previewUrlForInstall(`${ORIGIN}/mygame`, 'win-1')).rejects.toThrow(
      /neither https:\/\/example\.com\/mygame nor https:\/\/example\.com\/mygame\/manifest\.json/i
    )
    fetchManifest.mockClear()
    await expect(previewUrlForInstall(MANIFEST_URL, 'win-1')).rejects.toThrow(/404/)
    expect(fetchManifest).toHaveBeenCalledTimes(1)
  })

  it('refuses to install without a token from a preview', async () => {
    // The bug this guards: a one-call web install grants every declared permission
    // at a moment the user has never seen the list.
    await expect(confirmPendingInstall('made-up', 'win-1')).rejects.toThrow(/unknown or expired/i)
  })

  it('installs exactly the manifest that was previewed', async () => {
    fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))
    const preview = await previewUrlForInstall(MANIFEST_URL, 'win-1')
    // A literal, not `remote(...)`: that helper also rewrites what the extractor ships.
    fetchManifest.mockResolvedValue({
      ...packagedManifest,
      version: '9.9.9',
      permissions: ['storage.*', 'ai.chat', 'file.*']
    })
    fetchPackage.mockResolvedValue(downloadedFixture())

    await confirmPendingInstall(preview.installToken, 'win-1')

    const [row] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(row.version).toBe('1.0.0')
  })

  describe('installing over an installed app', () => {
    const noteUpdateAvailable = () => vi.mocked(application.get('MiniAppRuntimeService').noteUpdateAvailable)
    const installedRow = () =>
      dbh.db.select().from(miniAppInstallationTable).where(eq(miniAppInstallationTable.appId, APP_ID)).all()[0]

    it('upgrades from a newer manifest at the install entry through the update flow, without lighting the dot', async () => {
      // Same token, same quiesce, same rollback snapshot, same "only what was consented
      // to" grant rule as a web update — the whole reason this is not a second install path.
      const v1Hash = await seedInstalled({ consentedDeclaredJson: ['storage.get', 'storage.set'] })
      fetchManifest.mockResolvedValue(
        remote({ version: '1.1.0', permissions: ['storage.get', 'storage.set', 'ai.chat'] })
      )
      // Module-level mock, no `clearMocks`: an earlier check's `true` would fail the "not" below.
      noteUpdateAvailable().mockClear()

      const preview = await previewUrlRaw(MANIFEST_URL, 'win-1')

      expect(preview).toMatchObject({
        kind: 'upgrade',
        installed: { version: '1.0.0', source: 'url' },
        update: { status: 'needs-consent', version: '1.1.0', added: ['ai.chat'] }
      })
      // The user is holding the update in their hands — there is nothing to go and tell them about.
      expect(noteUpdateAvailable()).not.toHaveBeenCalledWith(APP_ID, expect.any(String))
      if (preview.kind !== 'upgrade') throw new Error('unreachable')

      fetchPackage.mockResolvedValue(downloadedFixture())
      await applyUpdate(APP_ID, { updateToken: preview.update.updateToken, consented: true })

      expect(installedRow()).toMatchObject({ version: '1.1.0', previousContentHash: v1Hash, source: 'url' })
      expect(grantsOf()).toEqual(['ai.chat', 'storage.get', 'storage.set'])
      expect(spy.order).toEqual([`quiesce:${APP_ID}`, 'mutate'])
    })

    it('moves a file-installed app onto the web source it was upgraded from', async () => {
      // The user typed the address themselves: the row is re-pinned to it, and the app
      // that could never check for updates now can.
      await seedInstalled({ source: 'file' })
      fetchManifest.mockResolvedValue(remote({ version: '1.1.0' }))

      const preview = await previewUrlRaw(MANIFEST_URL, 'win-1')
      expect(preview).toMatchObject({ kind: 'upgrade', source: 'url', installed: { source: 'file' } })
      if (preview.kind !== 'upgrade') throw new Error('unreachable')

      fetchPackage.mockResolvedValue(downloadedFixture())
      await applyUpdate(APP_ID, { updateToken: preview.update.updateToken })

      expect(installedRow()).toMatchObject({
        version: '1.1.0',
        source: 'url',
        sourceUrl: MANIFEST_URL,
        sourceOrigin: ORIGIN,
        sourceOriginCn: ORIGIN_CN
      })
      await expect(checkForUpdate(APP_ID)).resolves.toMatchObject({ status: 'current' })
    })

    it('reinstalls the same version only when the confirm says so, and keeps the row in place', async () => {
      await seedInstalled()
      fetchManifest.mockResolvedValue(remote({ version: '1.0.0' }))

      const shown = await previewUrlRaw(MANIFEST_URL, 'win-1')
      expect(shown).toMatchObject({ kind: 'install', installed: { version: '1.0.0', source: 'url', relation: 'same' } })
      if (shown.kind !== 'install') throw new Error('unreachable')
      // A confirm that ignores what the card said is a stale client, not an install.
      await expect(confirmPendingInstall(shown.installToken, 'win-1')).rejects.toThrow(/already installed/i)

      const again = asInstall(await previewUrlRaw(MANIFEST_URL, 'win-1'))
      fetchPackage.mockResolvedValue(downloadedFixture())
      await confirmPendingInstall(again.installToken, 'win-1', undefined, { clearData: false })

      // Not "uninstall + install": the launcher row keeps its place, and no snapshot is left behind.
      const [app] = dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).all()
      expect(app).toMatchObject({ status: 'enabled', orderKey: 'a0' })
      expect(installedRow()).toMatchObject({ version: '1.0.0', previousContentHash: null })
      expect(grantsOf()).toEqual(['storage.get', 'storage.set'])
      expect(spy.order).toEqual([`quiesce:${APP_ID}`, 'mutate'])
    })

    it('names an older package a downgrade', async () => {
      await seedInstalled()
      fetchManifest.mockResolvedValue(remote({ version: '0.9.0' }))

      await expect(previewUrlRaw(MANIFEST_URL, 'win-1')).resolves.toMatchObject({
        kind: 'install',
        installed: { relation: 'downgrade' }
      })
    })
  })
})
