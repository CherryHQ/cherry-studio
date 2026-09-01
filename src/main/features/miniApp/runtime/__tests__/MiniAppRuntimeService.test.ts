import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { BaseService } from '@main/core/lifecycle'

// Hoisted: `BaseService` imports `electron`, so the mock factory runs during the static
// import above — before any top-level `const` of this file would be initialised.
const { handle, sessions, fromPartition } = vi.hoisted(() => {
  const handle = vi.fn()

  /**
   * One session object per partition, and a scheme may be registered ONCE on it —
   * Electron's actual behaviour. A mock that lets `handle` be called twice makes the
   * "retry after a failed prepare" case pass while production throws.
   */
  const sessions = new Map<string, ReturnType<typeof makeSession>>()
  function makeSession() {
    const claimed = new Set<string>()
    return {
      protocol: {
        handle: vi.fn((scheme: string, ...rest: unknown[]) => {
          if (claimed.has(scheme)) throw new Error(`Attempted to register a second handler for '${scheme}'`)
          claimed.add(scheme)
          handle(scheme, ...rest)
        }),
        unhandle: vi.fn((scheme: string) => {
          if (!claimed.delete(scheme)) throw new Error(`No handler registered for '${scheme}'`)
        })
      },
      webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setProxy: vi.fn().mockResolvedValue(undefined)
    }
  }
  const fromPartition = vi.fn((partition: string) => {
    const existing = sessions.get(partition)
    if (existing) return existing
    const fresh = makeSession()
    sessions.set(partition, fresh)
    return fresh
  })
  return { handle, sessions, fromPartition }
})
vi.mock('electron', () => ({ session: { fromPartition }, webContents: { fromId: () => undefined } }))
// The network policy has its own suite; here it only has to resolve on a
// later tick, so the concurrency case below actually overlaps.
vi.mock('../network', () => ({
  installNetworkPolicy: vi.fn(() => new Promise<void>((r) => setImmediate(r)))
}))

// `unregisterGuest` aborts the guest's AI streams — the mock must be the one the
// service actually reaches, or the abort assertions measure nothing.
const abort = vi.hoisted(() => vi.fn())
import { mockMiniAppApplication } from '../../__tests__/applicationMock'

vi.mock('../../activityLog', () => ({
  ACTIVITY_COUNT_FLUSH_MS: 60_000,
  miniAppActivityLog: {
    recordCall: vi.fn(),
    recordGrant: vi.fn(),
    flush: vi.fn(async () => {}),
    forget: vi.fn(async () => {})
  }
}))
vi.mock('@application', () =>
  mockMiniAppApplication({
    AiStreamManager: { abort }
  })
)

const { MiniAppRuntimeService } = await import('../MiniAppRuntimeService')
// After the mock: a static import would evaluate the hoisted factory before `mockMiniAppApplication` exists.
const { application } = await import('@application')
const { aiCapability } = await import('../../capabilities/ai')
const { networkCapability } = await import('../../capabilities/network')

// `BaseService` throws on the second `new` of the same class, so without this reset the
// file dies at case two — naming the singleton guard, not anything under test.
beforeEach(() => {
  BaseService.resetInstances()
  sessions.clear()
  handle.mockClear()
  abort.mockClear()
})

describe('MiniAppRuntimeService', () => {
  it('registers the protocol once per partition', async () => {
    const svc = new MiniAppRuntimeService()
    // `onReady` resolves this after startup recovery, and `ensurePartition` waits on it so
    // that no guest can load a tree a crash left mid-publish. Stated, not stubbed away.
    svc.recovered.resolve(new Set())

    await svc.ensurePartition('com.example.a')
    await svc.ensurePartition('com.example.a')
    await svc.ensurePartition('com.example.b')

    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('registers once even when two prepares race', async () => {
    // The bug this guards: the `readyPartitions` guard is only set after the await,
    // so concurrent callers all pass it and `protocol.handle` throws on the second.
    const svc = new MiniAppRuntimeService()
    // `onReady` resolves this after startup recovery, and `ensurePartition` waits on it so
    // that no guest can load a tree a crash left mid-publish. Stated, not stubbed away.
    svc.recovered.resolve(new Set())

    await Promise.all([svc.ensurePartition('com.example.a'), svc.ensurePartition('com.example.a')])

    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('admits no guest until startup recovery has finished', async () => {
    // `IpcApiService` is `BeforeReady` and same-phase services initialise in PARALLEL, so
    // `mini_app.runtime.prepare` can arrive while `recoverInterruptedPublishes()` is still
    // walking the journal. A guest admitted in that window loads the tree the crash left in
    // place and keeps running it after recovery rolls that tree back — the new version's
    // code against the old version's grants.
    const svc = new MiniAppRuntimeService()
    let admitted = false

    const preparing = svc.ensurePartition('com.example.a').then(() => {
      admitted = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(admitted).toBe(false)
    // The load-bearing half: nothing was registered either, so there is no scheme for a
    // guest to fetch the mid-publish tree through.
    expect(handle).not.toHaveBeenCalled()

    svc.recovered.resolve(new Set())
    await preparing
    expect(admitted).toBe(true)
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('refuses the app whose startup repair failed, and only that one', async () => {
    // Recovery isolates a failure per entry and leaves that journal armed, so "recovery
    // finished" is not "this app is safe": its tree is whatever the crash left, which the
    // committed rows no longer describe. Per app — the others recovered and must still open.
    const svc = new MiniAppRuntimeService()
    svc.recovered.resolve(new Set(['com.example.broken']))

    await expect(svc.ensurePartition('com.example.broken')).rejects.toThrow(/could not be repaired/)
    // The load-bearing half: no scheme was registered either, so nothing can fetch the tree.
    expect(handle).not.toHaveBeenCalled()

    await expect(svc.ensurePartition('com.example.ok')).resolves.toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('opens the refused app once a fresh install has replaced what recovery left', async () => {
    // Recovery cannot run again in this process, so without this the app would be installed
    // and permanently unopenable until a restart. The mark must come off the barrier's OWN
    // payload — a second copy kept beside it reads back the refusal the barrier still hands out.
    const svc = new MiniAppRuntimeService()
    svc.recovered.resolve(new Set(['com.example.broken']))
    await expect(svc.ensurePartition('com.example.broken')).rejects.toThrow(/could not be repaired/)

    await svc.clearUnrepaired('com.example.broken')

    await expect(svc.ensurePartition('com.example.broken')).resolves.toBeUndefined()
  })

  it('lets a failed prepare be retried', async () => {
    const { installNetworkPolicy } = await import('../network')
    vi.mocked(installNetworkPolicy).mockRejectedValueOnce(new Error('boom'))
    const svc = new MiniAppRuntimeService()
    // `onReady` resolves this after startup recovery, and `ensurePartition` waits on it so
    // that no guest can load a tree a crash left mid-publish. Stated, not stubbed away.
    svc.recovered.resolve(new Set())

    await expect(svc.ensurePartition('com.example.c')).rejects.toThrow('boom')

    // The real assertion: the session must accept `protocol.handle` again. Registering
    // before the failable work leaves the scheme claimed and every retry throwing.
    await expect(svc.ensurePartition('com.example.c')).resolves.toBeUndefined()
    expect(svc.isPartitionReady('com.example.c')).toBe(true)
  })

  it('resolves a guest appId from its webContents id', () => {
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)

    expect(svc.resolveAppIdBySender(42)).toBe('com.example.a')
    expect(svc.resolveAppIdBySender(43)).toBeUndefined()
  })

  it('forgets a guest when it is unregistered', () => {
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)
    svc.unregisterGuest(42)

    expect(svc.resolveAppIdBySender(42)).toBeUndefined()
  })

  it('lists every live guest of one app', () => {
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 1)
    svc.registerGuest('com.example.a', 2)
    svc.registerGuest('com.example.b', 3)

    expect(svc.guestsOf('com.example.a').sort()).toEqual([1, 2])
  })

  it("aborts the guest's AI streams when it is unregistered", () => {
    // The bug this guards: forgetting the guest but leaving its stream running — the
    // host keeps paying for output nobody reads. Guests die without notice.
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)
    svc.rememberStream(42, 's1')
    svc.rememberStream(42, 's2')

    svc.unregisterGuest(42)

    expect(abort).toHaveBeenCalledWith('s1', expect.any(String))
    expect(abort).toHaveBeenCalledWith('s2', expect.any(String))
  })

  it("settles the guest's in-flight AI calls when it is unregistered", () => {
    // The abort above never reaches a dead listener (the manager drops it first), so
    // the slots those calls hold come back only through this hook — see `ai.test.ts`.
    const forgetGuest = vi.spyOn(aiCapability, 'forgetGuest')
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)

    svc.unregisterGuest(42)

    expect(forgetGuest).toHaveBeenCalledWith(42)
    forgetGuest.mockRestore()
  })

  it("aborts the guest's in-flight network requests when it is unregistered", () => {
    // lifecycle.md: a `cherry.network.fetch` waiting on a server dies with the guest, not 30 s later.
    const forgetGuest = vi.spyOn(networkCapability, 'forgetGuest')
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)

    svc.unregisterGuest(42)

    expect(forgetGuest).toHaveBeenCalledWith(42)
    forgetGuest.mockRestore()
  })

  it('does not abort a stream that already finished', () => {
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)
    svc.rememberStream(42, 's1')
    svc.forgetStream(42, 's1')

    svc.unregisterGuest(42)

    expect(abort).not.toHaveBeenCalled()
  })

  it('reports guest liveness for the stream listener', () => {
    const svc = new MiniAppRuntimeService()
    svc.registerGuest('com.example.a', 42)
    expect(svc.isGuestAlive(42)).toBe(true)

    svc.unregisterGuest(42)
    expect(svc.isGuestAlive(42)).toBe(false)
  })
})

describe('attention state', () => {
  const dbh = setupTestDatabase()

  /** Installed with `consented` as its baseline; the manifest always declares `storage.*`. */
  const seed = (appId: string, consented: string[]) => {
    dbh.db
      .insert(miniAppTable)
      .values({
        appId,
        kind: 'app',
        presetMiniAppId: null,
        name: 'A',
        url: `cherry-miniapp://${appId}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId,
        version: '1.0.0',
        contentHash: 'sha256:x',
        source: 'file',
        manifestJson: {
          id: appId,
          name: { en: 'A' },
          description: { en: 'A tiny sample game.' },
          version: '1.0.0',
          entry: 'index.html',
          permissions: ['storage.*'],
          optionalPermissions: [],
          network: []
        },
        consentedDeclaredJson: consented
      })
      .run()
  }
  const fullyConsented = ['storage.delete', 'storage.get', 'storage.keys', 'storage.set']
  const broadcast = () => vi.mocked(application.get('IpcApiService').broadcast)

  beforeEach(() => broadcast().mockClear())

  it('flags only the app whose declared wildcard grew past what the user consented to', () => {
    // Both directions: an app with a full baseline must NOT be flagged, or the badge is
    // always on and means nothing.
    seed('com.example.stale', ['storage.get', 'storage.set'])
    seed('com.example.current', fullyConsented)

    expect(new MiniAppRuntimeService().attentionState()).toEqual([
      {
        appId: 'com.example.stale',
        updateVersion: null,
        pendingPermissions: ['storage.delete', 'storage.keys'],
        updating: null
      }
    ])
  })

  it('snoozes host-added leaves for the launch without granting them, until a grant answers for good', () => {
    // "Not now" is process-local like the update fact: the reminder returns next launch,
    // and the leaves stay pending (the panel still offers them) — nothing is written.
    seed('com.example.stale', ['storage.get', 'storage.set'])
    const svc = new MiniAppRuntimeService()

    svc.snoozePending('com.example.stale')
    expect(svc.attentionState()).toEqual([])
    expect(broadcast()).toHaveBeenLastCalledWith('mini_app.runtime.attention', { apps: [] })

    svc.clearPendingSnooze('com.example.stale')
    expect(svc.attentionState()).toHaveLength(1)
  })

  it('lights the badge for an available update and clears it once the check says otherwise', () => {
    // The bug this guards: attention derived from consent alone. The app is fully
    // consented, so ONLY the update fact can put it in the list.
    seed('com.example.a', fullyConsented)
    const svc = new MiniAppRuntimeService()

    svc.noteUpdateAvailable('com.example.a', '1.1.0')
    const lit = [{ appId: 'com.example.a', updateVersion: '1.1.0', pendingPermissions: [], updating: null }]
    expect(svc.attentionState()).toEqual(lit)
    expect(svc.updateVersionOf('com.example.a')).toBe('1.1.0')
    expect(broadcast()).toHaveBeenLastCalledWith('mini_app.runtime.attention', { apps: lit })

    svc.noteUpdateAvailable('com.example.a', null)
    expect(svc.attentionState()).toEqual([])
    expect(broadcast()).toHaveBeenLastCalledWith('mini_app.runtime.attention', { apps: [] })
  })

  it('reports an update in flight with its progress, and refuses a second one', () => {
    // The tile draws the wedge from this; the refusal is what stops a second click from
    // downloading again during a long transfer and failing at the publish lock.
    seed('com.example.a', fullyConsented)
    const svc = new MiniAppRuntimeService()

    svc.beginUpdate('com.example.a', '1.1.0')
    expect(svc.attentionState()).toEqual([
      {
        appId: 'com.example.a',
        updateVersion: null,
        pendingPermissions: [],
        updating: { version: '1.1.0', fraction: null }
      }
    ])
    expect(() => svc.beginUpdate('com.example.a', '1.1.0')).toThrow(/already being updated/i)

    broadcast().mockClear()
    svc.noteUpdateProgress('com.example.a', 0.5)
    svc.noteUpdateProgress('com.example.a', 0.505) // under the 2% step: nothing to tell
    expect(broadcast()).toHaveBeenCalledTimes(1)
    expect(svc.attentionState()[0].updating).toEqual({ version: '1.1.0', fraction: 0.5 })

    svc.endUpdate('com.example.a')
    expect(svc.attentionState()).toEqual([])
  })

  it('does not carry a stale update badge onto a reinstall of the same id', () => {
    // Uninstall removes the row, so the badge vanishes for free; the leak shows only
    // when the id comes back — `forgetApp` is what keeps the fact from outliving the row.
    seed('com.example.a', fullyConsented)
    const svc = new MiniAppRuntimeService()
    svc.noteUpdateAvailable('com.example.a', '1.1.0')

    dbh.db.delete(miniAppTable).run()
    // `void`: the badge half runs synchronously, and the awaited half — the log removal —
    // has its own case in `MiniAppRuntimeService.activity.test.ts`.
    void svc.forgetApp('com.example.a')
    expect(broadcast()).toHaveBeenLastCalledWith('mini_app.runtime.attention', { apps: [] })
    seed('com.example.a', fullyConsented)

    expect(svc.attentionState()).toEqual([])
  })
})
