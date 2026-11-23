import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq, inArray } from 'drizzle-orm'
import { app, net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { cherryAccountCredentialStore } from '@main/services/cherryCloud/CherryAccountCredentialStore'
import * as appEdition from '@main/utils/appEdition'
import { getAppEdition } from '@main/utils/appEdition'

import { DesktopRegionService, inferDesktopEdition } from '../DesktopRegionService'

const resolveUrl = 'https://config.cherry-ai.com/v1/resolve'

function resolvedRegion(region: 'CN' | 'GLOBAL'): Response {
  return Response.json({ schema_version: 1, requires_region_selection: false, region })
}

describe('DesktopRegionService', () => {
  const db = setupTestDatabase()

  beforeEach(() => {
    vi.stubEnv('CHERRY_UNIFIED_RELEASE', '1')
    MockApplicationUtils.setService('ProxyService', { getAppliedSnapshot: async () => ({ converged: true }) })
    vi.spyOn(cherryAccountCredentialStore, 'get').mockReturnValue(null)
    db.db
      .delete(appStateTable)
      .where(
        inArray(appStateTable.key, ['desktop.region', 'desktop:region', 'app:region', 'desktopRegion:legacySession'])
      )
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    DesktopRegionService.resetInstances()
  })

  it.each([
    ['Asia/Shanghai', 'US', 'en-US', 'cn'],
    ['Etc/UTC', 'CN', 'en-US', 'cn'],
    ['Etc/UTC', '', 'zh-Hans-CN', 'cn'],
    ['Etc/UTC', '', 'zh-Hans', 'global']
  ])('infers region from %s, %s and %s', (zone, country, language, expected) => {
    expect(inferDesktopEdition(zone, country, language)).toBe(expected)
  })

  it('uses a confirmed profile region after restart without querying the network', async () => {
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('CN'))
    const first = new DesktopRegionService()
    await first._doInit()
    expect(getAppEdition()).toBe('cn')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(resolveUrl)
    expect(options?.method).toBe('POST')
    const platforms: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macos', win32: 'windows', linux: 'linux' }
    expect(JSON.parse(options?.body as string)).toEqual({
      client: 'community_desktop',
      platform: platforms[process.platform],
      app_version: app.getVersion()
    })
    expect(db.db.select().from(appStateTable).where(eq(appStateTable.key, 'app:region')).get()?.value).toEqual({
      region: 'cn',
      source: 'server'
    })
    await first._doStop()
    DesktopRegionService.resetInstances()

    fetch.mockRejectedValue(new Error('Offline'))
    const restarted = new DesktopRegionService()
    await restarted._doInit()
    expect(getAppEdition()).toBe('cn')
    expect(fetch).toHaveBeenCalledTimes(1)
    await restarted._doStop()
    DesktopRegionService.resetInstances()
  })

  it('confirms the saved region at login and rejects a different region', async () => {
    db.db
      .insert(appStateTable)
      .values({ key: 'app:region', value: { region: 'global', source: 'account' } })
      .run()

    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('GLOBAL'))
    fetch.mockResolvedValueOnce(resolvedRegion('CN'))
    const service = new DesktopRegionService()
    const signal = new AbortController().signal

    await expect(service.confirmLogin(signal)).resolves.toBe('global')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(resolveUrl)
    expect(JSON.parse(options?.body as string)).toMatchObject({ selected_region: 'GLOBAL' })

    await expect(service.confirmLogin(signal)).resolves.toBeNull()
    expect(db.db.select().from(appStateTable).where(eq(appStateTable.key, 'app:region')).get()?.value).toEqual({
      region: 'global',
      source: 'account'
    })
    DesktopRegionService.resetInstances()
  })

  it.each([
    { status: 503, body: { error: { code: 'REGION_UNAVAILABLE' } } },
    { status: 200, body: { schema_version: 1, requires_region_selection: true, region: 'GLOBAL' } }
  ])('keeps the local decision provisional until the server confirms a region ($status)', async ({ status, body }) => {
    db.db
      .insert(appStateTable)
      .values({ key: 'app:region', value: { region: 'cn', source: 'local' } })
      .run()
    vi.spyOn(net, 'fetch').mockResolvedValueOnce(Response.json(body, { status }))
    const service = new DesktopRegionService()
    await service._doInit()

    expect(getAppEdition()).toBe('cn')
    expect(db.db.select().from(appStateTable).where(eq(appStateTable.key, 'app:region')).get()?.value).toEqual({
      region: 'cn',
      source: 'local'
    })
    await service._doStop()
    DesktopRegionService.resetInstances()
  })

  it('carries the original package region for the same legacy session across the second hop', async () => {
    const isBridge = vi.spyOn(appEdition, 'isLegacySessionCompatibilityPackage').mockReturnValue(true)
    vi.spyOn(appEdition, 'getPackageEdition').mockReturnValue('cn')
    vi.mocked(cherryAccountCredentialStore.get).mockReturnValue({
      version: 1,
      devicePublicKey: 'public-key',
      devicePrivateKey: 'private-key',
      session: {
        accountId: 'account',
        sessionId: 'legacy-session',
        refreshToken: 'token',
        sessionExpiresAt: Date.now() + 60_000,
        deviceId: 'device',
        displayName: null
      }
    })
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('GLOBAL'))
    const bridge = new DesktopRegionService()
    await bridge._doInit()
    await bridge._doStop()
    DesktopRegionService.resetInstances()

    isBridge.mockReturnValue(false)
    appEdition.setRuntimeAppEdition('global')
    const unified = new DesktopRegionService()
    await unified._doInit()

    expect(getAppEdition()).toBe('cn')
    expect(unified.getLegacySessionEdition('legacy-session')).toBe('cn')
    expect(unified.getLegacySessionEdition('different-session')).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    await unified._doStop()
    DesktopRegionService.resetInstances()
  })

  it.each(['desktop.region', 'desktop:region'])(
    'renames %s without resolving the confirmed region again',
    async (key) => {
      const value = { region: 'cn', source: 'server' }
      db.db.insert(appStateTable).values({ key, value }).run()
      const fetch = vi.spyOn(net, 'fetch').mockRejectedValue(new Error('Offline'))
      const service = new DesktopRegionService()
      await service._doInit()

      expect(getAppEdition()).toBe('cn')
      expect(fetch).not.toHaveBeenCalled()
      expect(db.db.select().from(appStateTable).where(eq(appStateTable.key, 'app:region')).get()?.value).toEqual(value)
      expect(db.db.select().from(appStateTable).where(eq(appStateTable.key, key)).get()).toBeUndefined()
      await service._doStop()
      DesktopRegionService.resetInstances()
    }
  )

  it('keeps the provisional region until the confirmed result can apply on a later launch', async () => {
    db.db
      .insert(appStateTable)
      .values({ key: 'app:region', value: { region: 'cn', source: 'local' } })
      .run()
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('GLOBAL'))
    const provisional = new DesktopRegionService()
    await provisional._doInit()
    expect(getAppEdition()).toBe('cn')
    await provisional._doStop()
    DesktopRegionService.resetInstances()

    const confirmed = new DesktopRegionService()
    await confirmed._doInit()
    expect(getAppEdition()).toBe('global')
    expect(fetch).toHaveBeenCalledTimes(1)
    await confirmed._doStop()
    DesktopRegionService.resetInstances()
  })
})
