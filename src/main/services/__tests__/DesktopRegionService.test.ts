import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { inArray } from 'drizzle-orm'
import { app, net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { cherryAccountCredentialStore } from '@main/services/cherryCloud/CherryAccountCredentialStore'
import { getAppEdition } from '@main/utils/appEdition'

import { DesktopRegionService, inferDesktopEdition } from '../DesktopRegionService'

const resolveUrl = 'https://config.cherry-ai.com/v1/resolve'
const oldRegionKeys = ['app:region', 'desktop:region', 'desktop.region']

function resolvedRegion(region: 'CN' | 'GLOBAL'): Response {
  return Response.json({ schema_version: 1, requires_region_selection: false, region })
}

describe('DesktopRegionService', () => {
  const db = setupTestDatabase()

  beforeEach(() => {
    vi.stubEnv('CHERRY_UNIFIED_RELEASE', '1')
    MockApplicationUtils.setService('ProxyService', { getAppliedSnapshot: async () => ({ converged: true }) })
    vi.spyOn(cherryAccountCredentialStore, 'get').mockReturnValue(null)
    const localeOptions = new Intl.DateTimeFormat().resolvedOptions()
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...localeOptions,
      timeZone: 'Etc/UTC'
    })
    vi.spyOn(app, 'getLocaleCountryCode').mockReturnValue('US')
    db.db.delete(appStateTable).where(inArray(appStateTable.key, oldRegionKeys)).run()
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

  it.each(oldRegionKeys)('starts signed out from system settings and leaves the old %s row untouched', async (key) => {
    const value = { region: 'cn', source: 'server' }
    const oldRow = db.db.insert(appStateTable).values({ key, value }).returning().get()
    const fetch = vi.spyOn(net, 'fetch')
    const service = new DesktopRegionService()
    await service._doInit()

    expect(getAppEdition()).toBe('global')
    expect(fetch).not.toHaveBeenCalled()
    expect(db.db.select().from(appStateTable).where(inArray(appStateTable.key, oldRegionKeys)).all()).toEqual([oldRow])
    await service._doStop()
  })

  it.each([
    ['valid', 60_000, 'cn'],
    ['expired', -60_000, 'global']
  ])('starts from local information with a %s CN session', async (_status, remainingMs, edition) => {
    vi.mocked(cherryAccountCredentialStore.get).mockReturnValue({
      version: 1,
      devicePublicKey: 'public-key',
      devicePrivateKey: 'private-key',
      session: {
        apiOrigin: 'https://cloud.cherryai.com.cn',
        accountId: 'account',
        sessionId: 'session',
        refreshToken: 'token',
        sessionExpiresAt: Date.now() + remainingMs,
        deviceId: 'device',
        displayName: null
      }
    })
    const fetch = vi.spyOn(net, 'fetch')
    const service = new DesktopRegionService()
    await service._doInit()

    expect(getAppEdition()).toBe(edition)
    expect(fetch).not.toHaveBeenCalled()
    await service._doStop()
  })

  it.each([true, false])('hands off one startup read with credentials present: %s', async (hasCredentials) => {
    const initial = hasCredentials
      ? { version: 1 as const, devicePublicKey: 'public-key', devicePrivateKey: 'private-key', session: null }
      : null
    const updated = {
      version: 1 as const,
      devicePublicKey: 'new-public-key',
      devicePrivateKey: 'new-private-key',
      session: null
    }
    const get = vi.mocked(cherryAccountCredentialStore.get)
    get.mockReturnValueOnce(initial).mockReturnValue(updated)
    const service = new DesktopRegionService()
    await service._doInit()

    expect(service.takeStartupCredentials()).toBe(initial)
    expect(get).toHaveBeenCalledTimes(1)

    expect(service.takeStartupCredentials()).toBe(updated)
    expect(get).toHaveBeenCalledTimes(2)
    await service._doStop()
  })

  it('resolves each login automatically and applies the region in memory', async () => {
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('CN'))
    fetch.mockResolvedValueOnce(resolvedRegion('GLOBAL'))
    const service = new DesktopRegionService()
    await service._doInit()
    expect(fetch).not.toHaveBeenCalled()

    const signal = new AbortController().signal
    await expect(service.resolveLoginEdition(signal)).resolves.toBe('cn')
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

    await expect(service.resolveLoginEdition(signal)).resolves.toBe('global')
    expect(getAppEdition()).toBe('global')
    expect(db.db.select().from(appStateTable).where(inArray(appStateTable.key, oldRegionKeys)).all()).toEqual([])
    await service._doStop()
  })

  it.each([
    { status: 503, body: { error: { code: 'REGION_UNAVAILABLE' } } },
    { status: 200, body: { schema_version: 1, requires_region_selection: true, region: 'CN' } }
  ])('falls back to current system settings for an unusable response ($status)', async ({ status, body }) => {
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(resolvedRegion('CN'))
    fetch.mockResolvedValueOnce(Response.json(body, { status }))
    const service = new DesktopRegionService()
    await service._doInit()

    const signal = new AbortController().signal
    await service.resolveLoginEdition(signal)
    expect(getAppEdition()).toBe('cn')
    await expect(service.resolveLoginEdition(signal)).resolves.toBe('global')
    expect(getAppEdition()).toBe('global')
    await service._doStop()
  })

  it('ignores a cancelled attempt even if resolution returns an area', async () => {
    const controller = new AbortController()
    vi.spyOn(net, 'fetch').mockImplementationOnce(async () => {
      controller.abort()
      return resolvedRegion('CN')
    })
    const service = new DesktopRegionService()
    await service._doInit()

    await expect(service.resolveLoginEdition(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(getAppEdition()).toBe('global')
    await service._doStop()
  })
})
