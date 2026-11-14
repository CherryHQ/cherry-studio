import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app, session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { BaseService } from '@main/core/lifecycle'
import { BrowserSessionService } from '@main/features/browser'
import { createGuest } from '@main/features/browser/__tests__/guestFixture'
import { webviewHandlers } from '@main/ipc/handlers/webview'
import { getMiniAppRegionPartition } from '@shared/utils/miniAppRegion'

vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US', t: (key: string) => key }))

import { AnnotationSession } from '../AnnotationSession'
import { WebviewService } from '../WebviewService'

const NATIVE_UA = 'CherryStudio/1.0 Electron/1.0 Browser/1.0'
const SIGN_IN_URL = 'https://accounts.google.com/v3/signin/identifier'

function requestSession(partition: string) {
  const guestSession = session.fromPartition(partition)
  let userAgent = NATIVE_UA
  let handler: Parameters<Electron.WebRequest['onBeforeSendHeaders']>[0] = null
  Object.assign(guestSession, {
    getUserAgent: vi.fn(() => userAgent),
    setUserAgent: vi.fn((value: string) => {
      userAgent = value
    })
  })
  vi.mocked(guestSession.webRequest.onBeforeSendHeaders).mockImplementation((listener) => {
    handler = listener
  })
  return {
    guestSession,
    headers(url: string) {
      const requestHeaders = { 'User-Agent': userAgent, 'Accept-Language': 'zh-CN', Accept: '*/*' }
      let responseHeaders: Record<string, string | string[]> = requestHeaders
      handler?.(
        { url, requestHeaders, id: 1, method: 'GET', resourceType: 'xhr', referrer: '', timestamp: Date.now() },
        (response) => {
          responseHeaders = response.requestHeaders ?? requestHeaders
        }
      )
      return responseHeaders
    }
  }
}

let service: WebviewService
let browser: BrowserSessionService
const dbh = setupTestDatabase()

beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  MockApplicationUtils.resetServices()
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  dbh.db
    .insert(miniAppTable)
    .values({
      appId: 'demo',
      name: 'Demo',
      url: 'https://demo.example',
      status: 'enabled',
      orderKey: 'a0'
    })
    .run()
  MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
    'app.developer_mode.enabled': true,
    'feature.mini_app.fake_environment.enabled': true,
    'feature.mini_app.fake_environment.country': 'JP',
    'feature.mini_app.us_environment_app_ids': ['demo']
  })
  requestSession('persist:webview')
  vi.mocked(webContents.getAllWebContents).mockReturnValue([])
  browser = new BrowserSessionService()
  MockApplicationUtils.setService('BrowserSessionService', browser)
  service = new WebviewService()
})

afterEach(async () => {
  await service._doStop()
  await browser._doStop()
  MockApplicationUtils.resetServices()
  MockMainPreferenceServiceUtils.resetMocks()
})

describe('WebviewService regional lifecycle', () => {
  it.each([false, true])(
    'prepares a transient shared-cache site without a database row (regional mode: %s)',
    async (enabled) => {
      MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
        'app.developer_mode.enabled': enabled,
        'feature.mini_app.fake_environment.enabled': enabled,
        'feature.mini_app.region_profiles': {},
        'feature.mini_app.us_environment_app_ids': []
      })
      const appId = 'cherrystudio-guide'
      application.get('CacheService').setShared(`mini_app.transient_descriptor.${appId}`, {
        appId,
        name: 'User Guide',
        url: 'https://docs.cherry-ai.com/'
      })
      const host = createGuest(99).guest
      vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
        webContents: host
      } as Electron.BrowserWindow)
      MockApplicationUtils.setService('WebviewService', service)
      await service._doInit()

      await expect(webviewHandlers['webview.region.prepare']({ appId }, { senderId: 'owner' })).resolves.toEqual({
        partition: 'persist:webview',
        fake: false,
        leaseId: null
      })
      expect(
        dbh.db
          .select()
          .from(miniAppTable)
          .all()
          .map((row) => row.appId)
      ).toEqual(['demo'])
      await expect(webviewHandlers['webview.region.prepare']({ appId }, { senderId: null })).rejects.toThrow(
        'managed host'
      )
      await expect(
        webviewHandlers['webview.region.set_country']({ appId, country: 'JP' }, { senderId: 'owner' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  )

  it('prepares a saved file site in the default session and refuses regional admission', async () => {
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: 'file-site',
        name: 'File site',
        url: 'file:///C:/mini-app/index.html',
        orderKey: 'a1'
      })
      .run()
    const host = createGuest(99).guest
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host
    } as Electron.BrowserWindow)
    MockApplicationUtils.setService('WebviewService', service)
    await service._doInit()

    await expect(
      webviewHandlers['webview.region.prepare']({ appId: 'file-site' }, { senderId: 'owner' })
    ).resolves.toEqual({
      partition: 'persist:webview',
      fake: false,
      leaseId: null
    })
    await expect(
      webviewHandlers['webview.region.set_country']({ appId: 'file-site', country: 'JP' }, { senderId: 'owner' })
    ).rejects.toThrow('HTTP(S)')
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.region_profiles', { 'file-site': 'JP' })
    await expect(
      webviewHandlers['webview.region.prepare']({ appId: 'file-site' }, { senderId: 'owner' })
    ).resolves.toEqual({ partition: 'persist:webview', fake: false, leaseId: null })
    expect(service.isPreparedRegionalPartition(getMiniAppRegionPartition('file-site', 'JP'), host.id)).toBe(false)
  })

  it('refuses regional selection and preparation for an installed local MiniApp', async () => {
    const appId = 'com.example.local'
    dbh.db
      .insert(miniAppTable)
      .values({
        appId,
        kind: 'app',
        name: 'Local app',
        url: `cherry-miniapp://${appId}/index.html`,
        orderKey: 'a1'
      })
      .run()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId,
        version: '1.0.0',
        contentHash: 'sha256:local',
        source: 'file',
        manifestJson: {
          id: appId,
          name: { en: 'Local app' },
          description: { en: 'A local app.' },
          version: '1.0.0',
          entry: 'index.html',
          permissions: [],
          optionalPermissions: [],
          network: []
        }
      })
      .run()
    const host = createGuest(99).guest
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host
    } as Electron.BrowserWindow)
    MockApplicationUtils.setService('WebviewService', service)
    await service._doInit()

    await expect(
      webviewHandlers['webview.region.set_country']({ appId, country: 'JP' }, { senderId: 'owner' })
    ).rejects.toThrow('website MiniApp')
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.mini_app.region_profiles', { [appId]: 'JP' })
    await expect(webviewHandlers['webview.region.prepare']({ appId }, { senderId: 'owner' })).rejects.toThrow(
      'website MiniApp'
    )
    expect(service.isPreparedRegionalPartition(getMiniAppRegionPartition(appId, 'JP'), host.id)).toBe(false)
  })

  it('restores regional identity after restart and drains active work before reporting stop failure', async () => {
    const regional = requestSession(getMiniAppRegionPartition('demo', 'JP'))
    const registerSession = vi.fn(async () => {})
    const unregisterSession = vi.fn(async () => {})
    MockApplicationUtils.setService('ProxyService', { registerSession, unregisterSession })
    await service._doInit()
    const { guest, mock } = createGuest()
    const host = createGuest(99).guest
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host
    } as Electron.BrowserWindow)
    const prepared = await service.prepareRegionSession('demo', 'owner')
    const stop = vi.fn()
    const loadURL = vi.fn(async () => {})
    Object.assign(mock, {
      session: regional.guestSession,
      hostWebContents: host,
      isLoadingMainFrame: () => true,
      setWebRTCIPHandlingPolicy: vi.fn(),
      stop,
      loadURL
    })
    mock.getType.mockReturnValue('webview')
    vi.mocked(webContents.fromId).mockReturnValue(guest)
    vi.mocked(application.get('WindowManager').getWindow).mockReturnValue({
      webContents: host
    } as Electron.BrowserWindow)
    const onCreated = (
      vi.mocked(app.on).mock.calls as unknown as Array<
        [string, (event: unknown, contents: Electron.WebContents) => void]
      >
    ).find(([event]) => event === 'web-contents-created')![1]
    onCreated({}, guest)
    await service.waitForRegion(guest.id, 'owner')
    expect(regional.headers(SIGN_IN_URL)).toEqual({
      'User-Agent': NATIVE_UA,
      'Accept-Language': 'ja-JP,ja;q=0.9',
      Accept: '*/*'
    })

    await service._doStop()
    expect(regional.headers(SIGN_IN_URL)).toEqual({
      'User-Agent': 'Browser/1.0',
      'Accept-Language': 'zh-CN',
      Accept: '*/*'
    })
    mock.debugger.sendCommand.mockClear()
    vi.mocked(webContents.getAllWebContents).mockReturnValue([guest])
    await service._doInit()
    await service.waitForRegion(guest.id, 'owner')

    expect(regional.headers(SIGN_IN_URL)).toEqual({
      'User-Agent': NATIVE_UA,
      'Accept-Language': 'ja-JP,ja;q=0.9',
      Accept: '*/*'
    })
    expect(regional.headers('https://aistudio.google.com/')).toEqual({
      'User-Agent': 'Browser/1.0',
      'Accept-Language': 'ja-JP,ja;q=0.9',
      Accept: '*/*'
    })
    expect(mock.debugger.sendCommand).toHaveBeenCalledWith(
      'Emulation.setTimezoneOverride',
      { timezoneId: 'Asia/Tokyo' },
      undefined
    )
    expect(mock.debugger.sendCommand).toHaveBeenCalledWith(
      'Emulation.setUserAgentOverride',
      { userAgent: '', acceptLanguage: 'ja-JP,ja' },
      undefined
    )
    expect(service.isPreparedRegionalPartition(prepared.partition, host.id)).toBe(true)
    await expect(service.prepareRegionSession('demo', 'owner')).resolves.toMatchObject({
      partition: prepared.partition,
      fake: true
    })
    expect(registerSession).toHaveBeenCalledTimes(2)
    expect(stop).not.toHaveBeenCalled()
    expect(loadURL).not.toHaveBeenCalled()
    unregisterSession.mockRejectedValueOnce(new Error('proxy cleanup failed'))
    let finishIdle!: () => void
    const idle = new Promise<void>((resolve) => {
      finishIdle = resolve
    })
    const idleSpy = vi.spyOn(AnnotationSession.prototype, 'waitForIdle').mockReturnValueOnce(idle)
    let finished = false
    const stopping = service._doStop().then(
      () => {
        finished = true
        return null
      },
      (error) => {
        finished = true
        return error
      }
    )
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(finished).toBe(false)
      finishIdle()
      expect(await stopping).toMatchObject({ message: 'proxy cleanup failed' })
    } finally {
      finishIdle()
      idleSpy.mockRestore()
    }
    await vi.waitFor(() => expect(mock.debugger.isAttached()).toBe(false))
  })
})
