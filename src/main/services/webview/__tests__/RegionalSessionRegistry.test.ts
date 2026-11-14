import { EventEmitter } from 'node:events'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { miniAppHandlers } from '@data/api/handlers/miniApps'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { MINI_APP_REGIONS } from '@shared/types/miniAppRegion'
import { getMiniAppRegionPartition } from '@shared/utils/miniAppRegion'

import { RegionalSessionRegistry } from '../RegionalSessionRegistry'

type TestSession = Electron.Session & { cookie: string | null; httpCache: string | null; codeCache: string | null }

describe('regional session ownership and data removal', () => {
  const dbh = setupTestDatabase()
  let registry: RegionalSessionRegistry
  let hosts: Map<string, Electron.WebContents>
  let sessions: Map<string, TestSession>
  let registerSession: ReturnType<typeof vi.fn>
  let unregisterSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(application.get('DbService').withWriteTx).mockImplementation((fn) => dbh.db.transaction(fn))
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'feature.mini_app.fake_environment.enabled': true,
      'feature.mini_app.region_profiles': { alpha: 'JP', beta: 'US' }
    })
    for (const appId of ['alpha', 'beta']) {
      dbh.db
        .insert(miniAppTable)
        .values({
          appId,
          presetMiniAppId: null,
          name: appId,
          url: `https://${appId}.example`,
          status: 'enabled',
          orderKey: appId
        })
        .run()
    }
    hosts = new Map(
      ['one', 'two'].map((id, index) => [
        id,
        Object.assign(new EventEmitter(), {
          id: index + 10,
          isDestroyed: () => false
        }) as unknown as Electron.WebContents
      ])
    )
    vi.mocked(application.get('WindowManager').getWindow).mockImplementation((id) => {
      const host = hosts.get(id)
      return host ? ({ webContents: host, isDestroyed: () => false } as Electron.BrowserWindow) : undefined
    })
    sessions = new Map()
    vi.mocked(session.fromPartition).mockImplementation((partition) => {
      if (!sessions.has(partition)) {
        const current = {
          cookie: partition as string | null,
          httpCache: partition as string | null,
          codeCache: partition as string | null,
          webRequest: { onBeforeRequest: vi.fn() },
          closeAllConnections: vi.fn(async () => {}),
          clearStorageData: vi.fn(async () => {
            current.cookie = null
          }),
          clearCache: vi.fn(async () => {
            current.httpCache = null
          }),
          clearCodeCaches: vi.fn(async () => {
            current.codeCache = null
          })
        }
        sessions.set(partition, current as unknown as TestSession)
      }
      return sessions.get(partition)!
    })
    vi.mocked(webContents.getAllWebContents).mockReturnValue([])
    registerSession = vi.fn(async (guestSession: Electron.Session) => {
      guestSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: false }))
    })
    unregisterSession = vi.fn(async (guestSession: Electron.Session) => {
      guestSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
    })
    MockApplicationUtils.setService('ProxyService', { registerSession, unregisterSession })
    registry = new RegionalSessionRegistry(() => () => {})
    MockApplicationUtils.setService('WebviewService', {
      removeSiteMiniApp: (appId: string) => registry.removeApp(appId)
    })
  })

  afterEach(async () => {
    await registry.dispose()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('keeps different countries and admits only the host that prepared the app', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    const beta = await registry.prepare('beta', 'two')
    expect(alpha.partition).toBe('persist:webview-fake:JP:alpha')
    expect(beta.partition).toBe('persist:webview-us:beta')
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(true)
    expect(registry.isPrepared(alpha.partition, hosts.get('two')!.id)).toBe(false)
    await expect(registry.prepare('alpha', null)).rejects.toThrow()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.region_profiles', { 'missing-app': 'JP' })
    await expect(registry.prepare('missing-app', 'one')).rejects.toThrow()
    await expect(registry.release(alpha.leaseId!, 'two')).rejects.toThrow()
  })

  it('serializes selections from two windows without losing either saved country', async () => {
    await Promise.all([registry.setCountry('alpha', 'DE', 'one'), registry.setCountry('beta', 'FR', 'two')])
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.mini_app.region_profiles')).toEqual({
      alpha: 'DE',
      beta: 'FR'
    })
  })

  it('closes only the revoked host’s guest and popup while another host retains its lease', async () => {
    const first = await registry.prepare('alpha', 'one')
    await registry.prepare('alpha', 'two')
    const create = (host?: Electron.WebContents) => {
      let destroyed = false
      const guest = Object.assign(new EventEmitter(), {
        session: sessions.get(first.partition),
        hostWebContents: host,
        isDestroyed: () => destroyed,
        close: () => {
          destroyed = true
          guest.emit('destroyed')
        }
      }) as unknown as Electron.WebContents
      registry.trackGuest(guest)
      return guest
    }
    const one = create(hosts.get('one'))
    const two = create(hosts.get('two'))
    const popup = create()
    one.emit('did-create-window', { webContents: popup })
    vi.mocked(webContents.getAllWebContents).mockReturnValue([one, two, popup])
    await registry.release(first.leaseId!, 'one')
    expect(one.isDestroyed()).toBe(true)
    expect(popup.isDestroyed()).toBe(true)
    expect(two.isDestroyed()).toBe(false)
    expect(registry.isPrepared(first.partition, hosts.get('two')!.id)).toBe(true)
  })

  it('revokes every old lease and notifies hosts after fallback teardown succeeds', async () => {
    const one = await registry.prepare('alpha', 'one')
    const two = await registry.prepare('alpha', 'two')
    let destroyed = false
    let attempts = 0
    const guest = Object.assign(new EventEmitter(), {
      session: sessions.get(one.partition),
      hostWebContents: hosts.get('one'),
      isDestroyed: () => destroyed,
      close: () => {
        if (attempts++ === 0) throw new Error('transient close failure')
        destroyed = true
        guest.emit('destroyed')
      }
    }) as unknown as Electron.WebContents
    registry.trackGuest(guest)
    vi.mocked(webContents.getAllWebContents).mockReturnValue([guest])
    await expect(registry.release(one.leaseId!, 'one')).rejects.toThrow('transient close failure')
    expect(destroyed).toBe(true)
    expect(registry.isPrepared(two.partition, hosts.get('two')!.id)).toBe(false)
    expect(application.get('IpcApiService').broadcast).toHaveBeenCalledWith('webview.region.invalidated', {
      appId: 'alpha'
    })
    const recovered = await registry.prepare('alpha', 'two')
    await registry.release(two.leaseId!, 'two')
    expect(registry.isPrepared(recovered.partition, hosts.get('two')!.id)).toBe(true)
    expect(registerSession).toHaveBeenCalledTimes(2)
  })

  it('migrates old country selections once without overwriting an explicit default choice', async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.mini_app.region_profiles': { beta: null },
      'feature.mini_app.us_environment_app_ids': ['alpha', 'beta'],
      'feature.mini_app.fake_environment.country': 'FR'
    })
    await registry.resume()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.mini_app.region_profiles')).toEqual({
      alpha: 'FR',
      beta: null
    })
    const alpha = await registry.prepare('alpha', 'one')
    expect(alpha.partition).toBe('persist:webview-fake:FR:alpha')
    expect(await registry.prepare('beta', 'two')).toMatchObject({ partition: 'persist:webview', fake: false })
  })

  it('deletes the website row only after all regional data has been cleared', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    await registry.removeApp('alpha')
    expect(sessions.get(alpha.partition)!.cookie).toBeNull()
    expect(
      dbh.db
        .select()
        .from(miniAppTable)
        .all()
        .map((row) => row.appId)
    ).toEqual(['beta'])
    await expect(registry.setCountry('alpha', 'JP', 'one')).rejects.toThrow()
  })

  it('deletes a custom file site through the DataApi without clearing default site data', async () => {
    await miniAppHandlers['/mini-apps'].POST({
      body: { appId: 'file-site', name: 'File site', url: 'file:///C:/mini-app/index.html' }
    })
    const shared = session.fromPartition('persist:webview') as TestSession

    await miniAppHandlers['/mini-apps/:appId'].DELETE({ params: { appId: 'file-site' } })

    await expect(miniAppHandlers['/mini-apps/:appId'].GET({ params: { appId: 'file-site' } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    expect(shared.cookie).toBe('persist:webview')
    expect(shared.httpCache).toBe('persist:webview')
    expect(shared.codeCache).toBe('persist:webview')
  })

  it('clears historical HTTPS regions before deleting a site edited to a file URL', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    const oldCountry = session.fromPartition(getMiniAppRegionPartition('alpha', 'FR')) as TestSession
    await miniAppHandlers['/mini-apps/:appId'].PATCH({
      params: { appId: 'alpha' },
      body: { url: 'file:///C:/mini-app/index.html' }
    })
    let finish!: () => void
    vi.mocked(oldCountry.clearStorageData).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            oldCountry.cookie = null
            resolve()
          }
        })
    )

    const deleting = miniAppHandlers['/mini-apps/:appId'].DELETE({ params: { appId: 'alpha' } })
    const finished = deleting.then(
      () => null,
      (error) => error
    )
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await miniAppHandlers['/mini-apps/:appId'].GET({ params: { appId: 'alpha' } })).toMatchObject({
      kind: 'site',
      url: 'file:///C:/mini-app/index.html'
    })
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    finish()
    expect(await finished).toBeNull()

    for (const country of Object.keys(MINI_APP_REGIONS) as Array<keyof typeof MINI_APP_REGIONS>) {
      expect(sessions.get(getMiniAppRegionPartition('alpha', country))).toMatchObject({
        cookie: null,
        httpCache: null,
        codeCache: null
      })
    }
    await expect(miniAppHandlers['/mini-apps/:appId'].GET({ params: { appId: 'alpha' } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.mini_app.region_profiles')).toEqual({
      beta: 'US'
    })
  })

  it('opens an HTTPS site edited to a file URL without a regional lease or lost sign-ins', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    const previous = session.fromPartition(getMiniAppRegionPartition('alpha', 'FR')) as TestSession
    const shared = session.fromPartition('persist:webview') as TestSession
    let destroyed = false
    const guest = Object.assign(new EventEmitter(), {
      session: sessions.get(alpha.partition),
      hostWebContents: hosts.get('one'),
      isDestroyed: () => destroyed,
      close: () => {
        destroyed = true
        guest.emit('destroyed')
      }
    }) as unknown as Electron.WebContents
    registry.trackGuest(guest)
    vi.mocked(webContents.getAllWebContents).mockReturnValue([guest])
    await miniAppHandlers['/mini-apps/:appId'].PATCH({
      params: { appId: 'alpha' },
      body: { url: 'file:///C:/mini-app/index.html' }
    })

    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    expect(await registry.prepare('alpha', 'one')).toEqual({
      partition: 'persist:webview',
      fake: false,
      leaseId: null
    })
    expect(destroyed).toBe(true)
    expect(registry.sessions.has(sessions.get(alpha.partition)!)).toBe(false)
    for (const partition of [alpha.partition, getMiniAppRegionPartition('alpha', 'FR'), 'persist:webview']) {
      expect(sessions.get(partition)).toMatchObject({ cookie: partition, httpCache: partition, codeCache: partition })
    }
    expect(previous.cookie).not.toBeNull()
    expect(shared.cookie).toBe('persist:webview')
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.mini_app.region_profiles')).toEqual({
      alpha: 'JP',
      beta: 'US'
    })
    await expect(registry.setCountry('alpha', 'JP', 'one')).rejects.toThrow('HTTP(S)')
    await expect(registry.setCountry('alpha', null, null)).rejects.toThrow('managed host')
    await expect(registry.setCountry('missing-app', null, 'one')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await registry.setCountry('alpha', null, 'one')
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.mini_app.region_profiles')).toEqual({
      alpha: null,
      beta: 'US'
    })
    expect(await registry.prepare('transient-preview', 'one')).toEqual({
      partition: 'persist:webview',
      fake: false,
      leaseId: null
    })
  })

  it.each([false, true])('recovers failed cleanup after a file edit (edited before failure: %s)', async (editFirst) => {
    const alpha = await registry.prepare('alpha', 'one')
    const shared = session.fromPartition('persist:webview') as TestSession
    const previous = session.fromPartition(getMiniAppRegionPartition('alpha', 'FR')) as TestSession
    const edit = () =>
      miniAppHandlers['/mini-apps/:appId'].PATCH({
        params: { appId: 'alpha' },
        body: { url: 'file:///C:/mini-app/index.html' }
      })
    if (editFirst) await edit()
    vi.mocked(previous.clearCache).mockRejectedValueOnce(new Error('disk failure'))
    await expect(registry.clearData('alpha', 'one')).rejects.toThrow('disk failure')
    if (!editFirst) await edit()

    await registry.setCountry('alpha', null, 'one')
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    await expect(registry.prepare('alpha', 'one')).rejects.toThrow('unavailable')
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.fake_environment.enabled', false)
    await expect(registry.prepare('alpha', 'two')).rejects.toThrow('unavailable')
    vi.mocked(previous.clearCache).mockRejectedValueOnce(new Error('retry failure'))
    await expect(registry.clearData('alpha', 'one')).rejects.toThrow('retry failure')
    await expect(registry.prepare('alpha', 'two')).rejects.toThrow('unavailable')

    await registry.clearData('alpha', 'one')
    for (const country of Object.keys(MINI_APP_REGIONS) as Array<keyof typeof MINI_APP_REGIONS>) {
      expect(sessions.get(getMiniAppRegionPartition('alpha', country))).toMatchObject({
        cookie: null,
        httpCache: null,
        codeCache: null
      })
    }
    expect(shared).toMatchObject({
      cookie: 'persist:webview',
      httpCache: 'persist:webview',
      codeCache: 'persist:webview'
    })
    expect(await registry.prepare('alpha', 'two')).toEqual({
      partition: 'persist:webview',
      fake: false,
      leaseId: null
    })
  })

  it('revokes disabled profiles and host destruction without removing login data', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    const cookie = sessions.get(alpha.partition)!.cookie
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.region_profiles', { alpha: null, beta: 'US' })
    await registry.revokeInactive()
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    expect(sessions.get(alpha.partition)!.cookie).toBe(cookie)
    const beta = await registry.prepare('beta', 'two')
    hosts.get('two')!.emit('destroyed')
    await vi.waitFor(() => expect(registry.isPrepared(beta.partition, hosts.get('two')!.id)).toBe(false))
    expect(sessions.get(beta.partition)!.cookie).toBe(beta.partition)
  })

  it('cannot return a usable lease after preparation was revoked in flight', async () => {
    let finish!: () => void
    registerSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = registry.prepare('alpha', 'one')
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.region_profiles', { alpha: null })
    const revoke = registry.revokeInactive()
    finish()
    await revoke
    await rejected
    expect(registry.isPrepared(getMiniAppRegionPartition('alpha', 'JP'), hosts.get('one')!.id)).toBe(false)
  })

  it('blocks preparation during data reset and clears every country without touching the default session', async () => {
    const alpha = await registry.prepare('alpha', 'one')
    session.fromPartition('persist:webview')
    const previous = session.fromPartition(getMiniAppRegionPartition('alpha', 'FR'))
    let finish!: () => void
    vi.mocked(previous.clearStorageData).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const clearing = registry.clearData('alpha', 'one')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(registry.prepare('alpha', 'one')).rejects.toThrow()
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    finish()
    await clearing
    expect(sessions.get(alpha.partition)!.cookie).toBeNull()
    expect(sessions.get('persist:webview')!.cookie).toBe('persist:webview')
    const next = await registry.prepare('alpha', 'one')
    expect(next.partition).toBe(alpha.partition)
    expect(next.leaseId).not.toBe(alpha.leaseId)
  })

  it.each([
    ['JP', 'clearStorageData'],
    ['JP', 'clearCache'],
    ['JP', 'clearCodeCaches'],
    ['FR', 'clearStorageData'],
    ['FR', 'clearCache'],
    ['FR', 'clearCodeCaches']
  ] as const)('blocks the app after %s %s fails until an explicit successful reset', async (country, method) => {
    const alpha = await registry.prepare('alpha', 'one')
    const shared = session.fromPartition('persist:webview') as TestSession
    const failing = session.fromPartition(getMiniAppRegionPartition('alpha', country)) as TestSession
    vi.mocked(failing[method]).mockRejectedValueOnce(new Error('disk failure'))

    await expect(registry.clearData('alpha', 'one')).rejects.toThrow('disk failure')
    if (country === 'FR') {
      expect(sessions.get(alpha.partition)).toMatchObject({ cookie: null, httpCache: null, codeCache: null })
    }
    expect(registry.isPrepared(alpha.partition, hosts.get('one')!.id)).toBe(false)
    await expect(registry.prepare('alpha', 'one')).rejects.toThrow()
    await expect(registry.setCountry('alpha', 'DE', 'one')).rejects.toThrow()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.fake_environment.enabled', false)
    await expect(registry.prepare('alpha', 'one')).rejects.toThrow()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.fake_environment.enabled', true)
    for (const partition of new Set([alpha.partition, getMiniAppRegionPartition('alpha', country)])) {
      const requestResult = vi.fn()
      vi.mocked(sessions.get(partition)!.webRequest.onBeforeRequest).mock.lastCall![0]!(
        {} as Electron.OnBeforeRequestListenerDetails,
        requestResult
      )
      expect(requestResult).toHaveBeenCalledWith({ cancel: true })
    }

    vi.mocked(failing[method]).mockRejectedValueOnce(new Error('retry failure'))
    await expect(registry.clearData('alpha', 'one')).rejects.toThrow('retry failure')
    await expect(registry.prepare('alpha', 'two')).rejects.toThrow()
    await registry.clearData('alpha', 'one')

    for (const current of Object.keys(MINI_APP_REGIONS) as Array<keyof typeof MINI_APP_REGIONS>) {
      expect(sessions.get(getMiniAppRegionPartition('alpha', current))).toMatchObject({
        cookie: null,
        httpCache: null,
        codeCache: null
      })
    }
    expect(shared).toMatchObject({
      cookie: 'persist:webview',
      httpCache: 'persist:webview',
      codeCache: 'persist:webview'
    })
    const next = await registry.prepare('alpha', 'two')
    expect(next).toMatchObject({ partition: alpha.partition, fake: true })
    expect(next.leaseId).not.toBe(alpha.leaseId)
    expect(registry.isPrepared(next.partition, hosts.get('two')!.id)).toBe(true)
  })

  it.each([false, true])('keeps failed teardown blocked until reset succeeds (another host: %s)', async (shared) => {
    const alpha = await registry.prepare('alpha', 'one')
    if (shared) await registry.prepare('alpha', 'two')
    let canClose = false
    let destroyed = false
    const guest = Object.assign(new EventEmitter(), {
      session: sessions.get(alpha.partition),
      hostWebContents: hosts.get('one'),
      isDestroyed: () => destroyed,
      close: () => {
        if (canClose) {
          destroyed = true
          guest.emit('destroyed')
        }
      }
    }) as unknown as Electron.WebContents
    registry.trackGuest(guest)
    vi.mocked(webContents.getAllWebContents).mockReturnValue([guest])
    vi.useFakeTimers()
    try {
      const release = registry.release(alpha.leaseId!, 'one')
      const failed = expect(release).rejects.toThrow('did not close')
      await vi.advanceTimersByTimeAsync(10_001)
      await failed
      expect(registry.isPrepared(alpha.partition, hosts.get('two')!.id)).toBe(false)
      await expect(registry.prepare('alpha', 'one')).rejects.toThrow()
      expect(unregisterSession).toHaveBeenCalledWith(sessions.get(alpha.partition))
      canClose = true
      await registry.clearData('alpha', 'one')
      expect(destroyed).toBe(true)
      expect(sessions.get(alpha.partition)!.cookie).toBeNull()
      expect(await registry.prepare('alpha', 'one')).toMatchObject({ partition: alpha.partition, fake: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
