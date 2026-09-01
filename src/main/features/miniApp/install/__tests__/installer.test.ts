import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractMiniAppArchive } from '../archive'

vi.mock('@main/services/entityLogo', () => ({ setInstalledMiniAppLogo: vi.fn().mockResolvedValue(undefined) }))

const notifyDataApiDataChange = vi.fn()
vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange }))

// `uninstallMiniApp` goes offline through the runtime service, which the unified
// container does not know; the quiesce itself has its own suite, so here it just runs.
vi.mock('../../activityLog', () => ({
  ACTIVITY_COUNT_FLUSH_MS: 60_000,
  miniAppActivityLog: {
    recordCall: vi.fn(),
    recordGrant: vi.fn(),
    flush: vi.fn(async () => {}),
    forget: vi.fn(async () => {})
  }
}))
/**
 * The startup-recovery barrier, swappable: a fresh install waits on it before it sweeps the
 * slate, so it is resolved for every case but the one that holds it open on purpose.
 * `quiesced` is that case's sync point — it fires immediately before the wait.
 */
const barrier = vi.hoisted(() => ({ current: Promise.resolve(new Set<string>()) as Promise<ReadonlySet<string>> }))
const quiesced = vi.hoisted(() => vi.fn())
const clearUnrepaired = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    MiniAppRuntimeService: {
      withAppQuiesced: (appId: string, mutate: () => Promise<unknown>) => {
        quiesced(appId)
        return mutate()
      },
      get recovered() {
        return barrier.current
      },
      clearUnrepaired,
      forgetApp: vi.fn(),
      // Reached at the END of a reinstall. Without it the reinstall cases die there, which
      // silently turns "the journal was buried" into "something else threw first".
      noteUpdateAvailable: vi.fn()
    }
  })
})

// The global electron mock has no `session.fromPartition`, and uninstall clears the
// app's partition; `app.getLocale` is what `getAppLanguage` reads on install.
// `clearStorageData` is hoisted rather than built inside the factory: `fromPartition`
// hands back a fresh object per call, so a spy on that object is unreachable from a test —
// and whether the partition sweep RAN is exactly what the cases below assert.
const clearStorageData = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('electron', () => ({
  app: { getLocale: vi.fn(() => 'en-US') },
  session: {
    fromPartition: vi.fn(() => ({
      clearStorageData,
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearCodeCaches: vi.fn().mockResolvedValue(undefined)
    }))
  }
}))

const {
  installMiniAppFromFile,
  installExtracted,
  createStagingDir,
  stageMiniAppFromFile,
  sweepAbandonedStaging,
  uninstallMiniApp,
  wipeMiniAppData
} = await import('../installer')
const { miniAppDataPath, miniAppInstallPath, miniAppStorageFile } = await import('../../paths')
const { MINI_APP_OFFICIAL_ORIGINS } = await import('@shared/types/miniAppManifest')

const APP_ID = 'com.example.mygame'
const MANIFEST = {
  id: APP_ID,
  name: 'My Game',
  description: 'A tiny sample game.',
  version: '1.0.0',
  entry: 'index.html',
  permissions: ['storage.get', 'storage.set']
}

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-install-'))
  // Key-aware, filename-aware — a flat `mockReturnValue(work)` hands the journal a
  // DIRECTORY to `writeFileSync` and collapses `data/` into `packages/`.
  vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
    const dir =
      key === 'feature.mini_app.publish_journal'
        ? path.join(work, '.publish-journal')
        : key === 'feature.mini_app.data'
          ? path.join(work, 'data')
          : path.join(work, 'packages')
    return filename ? path.join(dir, filename) : dir
  })
})
afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

async function makePackage(over: Record<string, unknown> = {}): Promise<string> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ ...MANIFEST, ...over }))
  zip.file('index.html', '<h1>hi</h1>')
  const p = path.join(work, `pkg-${Math.random().toString(36).slice(2)}.miniapp`)
  fs.writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
  return p
}

describe('installMiniAppFromFile', () => {
  const dbh = setupTestDatabase()

  it('creates the app row, installation row, grants, and disk files', async () => {
    const app = await installMiniAppFromFile(await makePackage())

    expect(app).toMatchObject({ appId: APP_ID, kind: 'app', version: '1.0.0' })
    expect(app.url).toBe(`cherry-miniapp://${APP_ID}/index.html`)

    const [install] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(install).toMatchObject({ appId: APP_ID, version: '1.0.0', source: 'file' })
    expect(fs.readFileSync(path.join(miniAppInstallPath(APP_ID), 'index.html'), 'utf8')).toBe('<h1>hi</h1>')

    expect(
      dbh.db
        .select()
        .from(miniAppGrantTable)
        .all()
        .map((g) => g.permission)
    ).toEqual(['storage.get', 'storage.set'])
  })

  it('refuses a file package that claims the reserved namespace', async () => {
    // Not "installs it without a badge": `appId` is the primary key, so one squatting
    // install occupies the official id forever and the real package never gets in.
    await expect(installMiniAppFromFile(await makePackage({ id: 'com.cherrystudio.miniapp.notes' }))).rejects.toThrow(
      /reserved/i
    )
  })

  it('accepts that same id from the builtin source', async () => {
    // The control for the case above: it must fail on the PREFIX RULE, not on a
    // malformed id. Without it a broken `makePackage` passes the negative for free.
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage({ id: 'com.cherrystudio.miniapp.notes' }), staging)
    await expect(installExtracted(manifest, staging, { source: 'builtin' })).resolves.toMatchObject({
      appId: 'com.cherrystudio.miniapp.notes'
    })
  })

  it('refuses a builtin package outside the builtin prefix', async () => {
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage(), staging)
    await expect(installExtracted(manifest, staging, { source: 'builtin' })).rejects.toThrow(/must live under/i)
  })

  it('refuses the reserved namespace when only the GLOBAL origin is official', async () => {
    // The bypass: pair a dead official global address with an attacker CN mirror, and
    // `sourceOrigin` still reads as official while the bytes came from the attacker.
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage({ id: 'com.cherrystudio.miniapp.notes' }), staging)
    await expect(
      installExtracted(manifest, staging, {
        source: 'url',
        sourceUrl: `${MINI_APP_OFFICIAL_ORIGINS[0]}/notes/manifest.json`,
        sourceOrigin: MINI_APP_OFFICIAL_ORIGINS[0],
        sourceOriginCn: 'https://attacker.cn'
      })
    ).rejects.toThrow(/reserved/i)
  })

  it('accepts the reserved namespace when BOTH origins are official', async () => {
    // The positive control. Without it the case above passes against an implementation
    // that simply refuses every official-namespace url install.
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage({ id: 'com.cherrystudio.miniapp.notes' }), staging)
    await expect(
      installExtracted(manifest, staging, {
        source: 'url',
        sourceUrl: `${MINI_APP_OFFICIAL_ORIGINS[0]}/notes/manifest.json`,
        sourceOrigin: MINI_APP_OFFICIAL_ORIGINS[0],
        sourceOriginCn: MINI_APP_OFFICIAL_ORIGINS.at(1) ?? MINI_APP_OFFICIAL_ORIGINS[0]
      })
    ).resolves.toMatchObject({ appId: 'com.cherrystudio.miniapp.notes' })
  })

  it('accepts the reserved namespace with only an official global origin pinned', async () => {
    // No accelerator declared: "every pinned origin is official" must not read an absent
    // mirror as a foreign one, or no official package could ship without a mirror.
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage({ id: 'com.cherrystudio.miniapp.notes' }), staging)
    await expect(
      installExtracted(manifest, staging, {
        source: 'url',
        sourceUrl: `${MINI_APP_OFFICIAL_ORIGINS[0]}/notes/manifest.json`,
        sourceOrigin: MINI_APP_OFFICIAL_ORIGINS[0]
      })
    ).resolves.toMatchObject({ appId: 'com.cherrystudio.miniapp.notes' })
  })

  it('grants every optional leaf by default, and only the ticked ones when told', async () => {
    // Android's model: optional starts on and is the user's to untick. Omitting the choice
    // grants all of them; an explicit list grants exactly that list; a leaf the package never
    // declared cannot be smuggled in through it.
    const declare = { permissions: ['storage.get'], optionalPermissions: ['notification.show', 'storage.set'] }
    const grantsOf = (id: string) =>
      dbh.db
        .select()
        .from(miniAppGrantTable)
        .all()
        .filter((row) => row.appId === id)
        .map((row) => row.permission)
        .sort()

    const all = await extractMiniAppArchive(
      await makePackage({ id: 'com.example.all', ...declare }),
      await createStagingDir()
    )
    await installExtracted(all, await createStagingDir(), { source: 'file' })
    expect(grantsOf('com.example.all')).toEqual(['notification.show', 'storage.get', 'storage.set'])

    const some = await extractMiniAppArchive(
      await makePackage({ id: 'com.example.some', ...declare }),
      await createStagingDir()
    )
    await installExtracted(
      some,
      await createStagingDir(),
      { source: 'file' },
      { grantedOptional: ['storage.set', 'ai.chat'] }
    )
    expect(grantsOf('com.example.some')).toEqual(['storage.get', 'storage.set'])
  })

  it('refuses to overwrite an already-installed id', async () => {
    await installMiniAppFromFile(await makePackage())
    await expect(installMiniAppFromFile(await makePackage())).rejects.toThrow(/already installed/i)
  })

  it('persists no absolute path — userData relocation would invalidate it', async () => {
    await installMiniAppFromFile(await makePackage())
    const [row] = dbh.db.select().from(miniAppInstallationTable).all()
    expect(Object.values(row).some((v) => typeof v === 'string' && v.startsWith('/'))).toBe(false)
  })

  it('writes nothing when the package is rejected', async () => {
    await expect(installMiniAppFromFile(await makePackage({ id: 'BAD_ID' }))).rejects.toThrow()
    expect(dbh.db.select().from(miniAppTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(0)
  })

  it('stages a package without installing anything', async () => {
    const staged = await stageMiniAppFromFile(await makePackage())

    expect(fs.existsSync(path.join(staged.stagingDir, 'index.html'))).toBe(true)
    expect(staged.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The point of the split: nothing committed, nothing granted, before consent.
    expect(dbh.db.select().from(miniAppTable).all()).toEqual([])
    expect(dbh.db.select().from(miniAppGrantTable).all()).toEqual([])
  })

  it('leaves no staging tree behind when staging fails', async () => {
    await expect(stageMiniAppFromFile(await makePackage({ id: 'BAD_ID' }))).rejects.toThrow()

    const leftovers = fs.readdirSync(path.join(work, 'packages')).filter((n) => n.startsWith('.staging-'))
    expect(leftovers).toEqual([])
  })

  it('sweeps the remaining staging dirs when one refuses to delete, and counts reality', async () => {
    // Startup runs once: aborting on the first EPERM would shield every later leftover.
    // Rejection targeted BY PATH — Node guarantees no readdir order to pin a "first" on.
    const packages = path.join(work, 'packages')
    fs.mkdirSync(path.join(packages, '.staging-a'), { recursive: true })
    fs.mkdirSync(path.join(packages, '.staging-b'), { recursive: true })
    const realRm = fs.promises.rm.bind(fs.promises)
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, opts) =>
        String(target).endsWith('.staging-a') ? Promise.reject(new Error('EPERM')) : realRm(target, opts)
      )
    try {
      // The survivor may not inflate the count — the log's `removed` is a claim.
      await expect(sweepAbandonedStaging()).resolves.toBe(1)
    } finally {
      rm.mockRestore()
    }

    expect(fs.existsSync(path.join(packages, '.staging-a'))).toBe(true)
    expect(fs.existsSync(path.join(packages, '.staging-b'))).toBe(false)
  })

  it('publishes a /mini-apps membership change after install and uninstall commit', async () => {
    // Install and uninstall are IpcApi writes: no DataApi mutation runs, so this
    // signal is the ONLY thing standing between the launcher and a stale list.
    notifyDataApiDataChange.mockClear()

    await installMiniAppFromFile(await makePackage())
    expect(notifyDataApiDataChange).toHaveBeenCalledWith([{ endpoint: '/mini-apps', kind: 'membership' }])

    notifyDataApiDataChange.mockClear()
    await uninstallMiniApp(APP_ID)
    expect(notifyDataApiDataChange).toHaveBeenCalledWith([{ endpoint: '/mini-apps', kind: 'membership' }])
  })

  it('publishes nothing when the install is refused', async () => {
    // The contract's other half: notify after commit means never on a refusal — a
    // refetch storm on failed installs would be wrong, a signal with no write worse.
    notifyDataApiDataChange.mockClear()

    await expect(installMiniAppFromFile(await makePackage({ id: 'BAD_ID' }))).rejects.toThrow()

    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('removes rows, grants, the package AND the save file on uninstall', async () => {
    await installMiniAppFromFile(await makePackage())
    const installPath = miniAppInstallPath(APP_ID)
    await fs.promises.mkdir(miniAppDataPath(APP_ID), { recursive: true })
    await fs.promises.writeFile(miniAppStorageFile(APP_ID), '{"score":"9000"}')

    await uninstallMiniApp(APP_ID)

    expect(dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).all()).toHaveLength(0)
    expect(dbh.db.select().from(miniAppGrantTable).all()).toHaveLength(0)
    expect(fs.existsSync(installPath)).toBe(false)
    // The half that is easy to miss: `data/` is a sibling of `packages/`, so removing the
    // install path does not touch it, and a reinstall would read the old owner's save.
    expect(fs.existsSync(miniAppDataPath(APP_ID))).toBe(false)
  })

  it('reports a committed uninstall as success even when a tree refuses to delete', async () => {
    // The bug this guards: an unguarded `rm` after the commit. The rows are gone, so
    // "uninstall failed" is a lie, and the launcher never hears the row set changed.
    await installMiniAppFromFile(await makePackage())
    const installPath = miniAppInstallPath(APP_ID)
    notifyDataApiDataChange.mockClear()
    const realRm = fs.promises.rm.bind(fs.promises)
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, opts) =>
        String(target) === installPath ? Promise.reject(new Error('EPERM')) : realRm(target, opts)
      )
    clearStorageData.mockClear()
    try {
      await expect(uninstallMiniApp(APP_ID)).resolves.toBeUndefined()
    } finally {
      rm.mockRestore()
    }

    expect(dbh.db.select().from(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).all()).toHaveLength(0)
    expect(notifyDataApiDataChange).toHaveBeenCalledWith([{ endpoint: '/mini-apps', kind: 'membership' }])
    // The partition is swept even though a tree refused. `swept &&= await clear()` used to
    // short-circuit here, so one EPERM left the uninstalled app's cookies for the next
    // install of the same id — the one leak a fresh install must never have.
    expect(clearStorageData).toHaveBeenCalled()
  })

  it('clears the partition even when the data tree refuses, and reports the clear as failed', async () => {
    // Two defects in one line. `swept &&= await clearPartition()` short-circuited, so a
    // data tree that threw skipped the partition entirely; and the call resolved anyway,
    // so `clearMiniAppData` recorded a `clear_data` grant for a clear that never happened.
    await installMiniAppFromFile(await makePackage())
    const data = miniAppDataPath(APP_ID)
    const realRm = fs.promises.rm.bind(fs.promises)
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, opts) =>
        String(target) === data ? Promise.reject(new Error('EBUSY')) : realRm(target, opts)
      )
    clearStorageData.mockClear()
    try {
      await expect(wipeMiniAppData(APP_ID)).rejects.toThrow(/could not be fully cleared/i)
    } finally {
      rm.mockRestore()
    }

    expect(clearStorageData).toHaveBeenCalled()
  })

  it('leaves a failed clear armed in the journal instead of letting a reinstall bury it', async () => {
    // There is ONE journal file per app and `writePublishJournal` overwrites it, so a
    // reinstall that carried on past a failed wipe replaced the pending `clear-data` with
    // its own `reinstall` entry — whose roll-forward touches neither the save file nor the
    // partition. The retry recovery was holding simply disappeared.
    await installMiniAppFromFile(await makePackage())
    const journal = path.join(work, '.publish-journal', `${APP_ID}.json`)
    const data = miniAppDataPath(APP_ID)
    const realRm = fs.promises.rm.bind(fs.promises)
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, opts) =>
        String(target) === data ? Promise.reject(new Error('EBUSY')) : realRm(target, opts)
      )
    const staging = await createStagingDir()
    const manifest = await extractMiniAppArchive(await makePackage(), staging)
    // Captured rather than `rejects.toThrow`, so BOTH assertions below run: when the
    // reinstall wrongly succeeds, the journal one is the half that names the damage.
    const failure = await installExtracted(manifest, staging, { source: 'file' }, {}, { clearData: true }).then(
      () => null,
      (error: Error) => error
    )
    rm.mockRestore()

    expect(failure?.message).toMatch(/could not be fully cleared/i)
    // `null` here means a `reinstall` entry landed on top and its own commit then cleared
    // the file — carrying the pending clear away with it.
    expect(fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : null).toMatchObject({
      kind: 'clear-data',
      appId: APP_ID
    })
  })

  it("gives a reinstalled appId an empty save file, not the previous owner's", async () => {
    // The bug the case above only implies: uninstall + reinstall is how a user "starts over",
    // and inheriting the last install's data makes that a lie.
    await installMiniAppFromFile(await makePackage())
    await fs.promises.mkdir(miniAppDataPath(APP_ID), { recursive: true })
    await fs.promises.writeFile(miniAppStorageFile(APP_ID), '{"score":"9000"}')
    await uninstallMiniApp(APP_ID)

    await installMiniAppFromFile(await makePackage())

    expect(fs.existsSync(miniAppStorageFile(APP_ID))).toBe(false)
  })

  it('refuses a fresh install onto state an unfinished uninstall left behind', async () => {
    // The case above covers the uninstall that WORKED. This is the one that did not: cleanup
    // is best-effort, so the rows go, the save file stays, and the journal is armed for a
    // recovery that only runs at startup — which an install in this same process never waits
    // for. The appId comes from the manifest, so the next owner need not be the same
    // publisher, and what it would inherit is a saved token and a live session.
    await installMiniAppFromFile(await makePackage())
    await fs.promises.mkdir(miniAppDataPath(APP_ID), { recursive: true })
    await fs.promises.writeFile(miniAppStorageFile(APP_ID), '{"token":"secret"}')
    const next = await makePackage()

    const data = miniAppDataPath(APP_ID)
    const realRm = fs.promises.rm.bind(fs.promises)
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockImplementation((target, opts) =>
        String(target) === data ? Promise.reject(new Error('EBUSY')) : realRm(target, opts)
      )
    try {
      // Resolves: the rows ARE committed, and reporting a failure over them would be a lie.
      await uninstallMiniApp(APP_ID)

      await expect(installMiniAppFromFile(next)).rejects.toThrow(/still holds state/i)
    } finally {
      rm.mockRestore()
    }

    // Refused, not half-published — and the debt is still on record for the next launch.
    expect(dbh.db.select().from(miniAppTable).all()).toHaveLength(0)
    expect(fs.readFileSync(miniAppStorageFile(APP_ID), 'utf8')).toContain('secret')
    expect(JSON.parse(fs.readFileSync(path.join(work, '.publish-journal', `${APP_ID}.json`), 'utf8'))).toMatchObject({
      kind: 'uninstall',
      appId: APP_ID
    })
  })

  it('publishes nothing until startup recovery has finished', async () => {
    // Recovery repairs these same trees. Sweeping the slate underneath it publishes an app
    // that owns whatever the repair puts back a moment later.
    let release: (value: ReadonlySet<string>) => void = () => {}
    barrier.current = new Promise<ReadonlySet<string>>((resolve) => {
      release = resolve
    })
    const pkg = await makePackage()
    quiesced.mockClear()

    const installing = installMiniAppFromFile(pkg)
    // Staging is real I/O, so wall-clock ticks would let a barrier-less version race
    // through. `quiesced` fires on the statement before the wait — that is the sync point.
    await vi.waitFor(() => expect(quiesced).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))

    expect(dbh.db.select().from(miniAppTable).all()).toHaveLength(0)

    release(new Set())
    await installing
    expect(dbh.db.select().from(miniAppTable).all()).toHaveLength(1)
    barrier.current = Promise.resolve(new Set<string>())
  })

  it('lifts the barrier’s refusal for the id it just re-established', async () => {
    // Startup recovery may have marked this id unopenable. `assertCleanSlate` has since
    // removed the very trees that verdict was about, and recovery cannot run again in this
    // process — so an install that leaves the mark standing produces an app that is
    // installed, listed, and refused by `ensurePartition` until the next launch.
    clearUnrepaired.mockClear()

    await installMiniAppFromFile(await makePackage())

    expect(clearUnrepaired).toHaveBeenCalledWith(APP_ID)
  })

  it('sweeps the partition too, not just the trees, before a fresh install publishes', async () => {
    // Cookies and the HTTP cache hang off the partition, which no row cascades: an install
    // that swept only the directories would still resume the previous owner's identity.
    await installMiniAppFromFile(await makePackage())
    await uninstallMiniApp(APP_ID)
    clearStorageData.mockClear()

    await installMiniAppFromFile(await makePackage())

    expect(clearStorageData).toHaveBeenCalled()
  })

  it('refuses to uninstall a site mini app', async () => {
    // The bug this guards: this entry point deletes a row by id and removes a
    // directory. Without a kind check it does that to a preset or a plain site too.
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: 'openai',
        kind: 'site',
        presetMiniAppId: 'openai',
        name: 'OpenAI',
        url: 'https://chat.openai.com',
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

    await expect(uninstallMiniApp('openai')).rejects.toThrow(/site|locally installed/i)
    expect(dbh.db.select().from(miniAppTable).all()).toHaveLength(1)
  })

  it('refuses to uninstall an id that is not installed at all', async () => {
    await expect(uninstallMiniApp('com.example.ghost')).rejects.toThrow(/not installed/i)
  })

  it('lets only one of two concurrent installs of the same id win', async () => {
    // The bug this guards: "is this id taken?" is a check-then-act spanning the
    // filesystem AND the database, so both callers pass it before either commits.
    const [a, b] = await Promise.allSettled([
      installMiniAppFromFile(await makePackage()),
      installMiniAppFromFile(await makePackage())
    ])

    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(1)
  })

  it('reinstalls an id whose uninstall was interrupted', async () => {
    // Rows gone, directory left behind. Refusing here would make the appId
    // permanently unusable — the exact failure the journal exists to end.
    await installMiniAppFromFile(await makePackage())
    dbh.db.delete(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).run()
    expect(fs.existsSync(miniAppInstallPath(APP_ID))).toBe(true)

    await expect(installMiniAppFromFile(await makePackage())).resolves.toMatchObject({ appId: APP_ID })
  })

  it('keeps a committed install when only the icon step fails', async () => {
    // The bug this guards: rolling the disk back after the rows are committed leaves
    // an entry that can never load and an id that can never be reinstalled.
    const { setInstalledMiniAppLogo } = await import('@main/services/entityLogo')
    vi.mocked(setInstalledMiniAppLogo).mockClear().mockRejectedValueOnce(new Error('disk full'))

    const app = await installMiniAppFromFile(await makePackage())

    // The injected failure must have been CONSUMED — an icon path that never reaches
    // the logo pipeline passes this case for free.
    expect(setInstalledMiniAppLogo).toHaveBeenCalledTimes(1)
    expect(app.appId).toBe(APP_ID)
    expect(fs.existsSync(path.join(miniAppInstallPath(APP_ID), 'index.html'))).toBe(true)
    expect(dbh.db.select().from(miniAppInstallationTable).all()).toHaveLength(1)
  })

  it('disarms the journal once the install is committed', async () => {
    // A journal left armed after a successful install is worse than no journal:
    // the next startup reclaims a live app.
    const { recoverInterruptedPublishes } = await import('../publishJournal')
    await installMiniAppFromFile(await makePackage())

    // NOTHING to recover — not "the files survived": a journal left armed rolls a
    // committed install FORWARD (a no-op), so the tree survives either way.
    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
    expect(fs.existsSync(miniAppInstallPath(APP_ID))).toBe(true)
  })
})
