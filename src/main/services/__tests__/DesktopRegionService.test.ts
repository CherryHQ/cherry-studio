import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq, inArray } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { cherryAccountCredentialStore } from '@main/services/cherryCloud/CherryAccountCredentialStore'
import * as appEdition from '@main/utils/appEdition'
import { getAppEdition } from '@main/utils/appEdition'

import { DesktopRegionService, inferDesktopEdition } from '../DesktopRegionService'

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
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(Response.json({ region: 'CN' }))
    const first = new DesktopRegionService()
    await first._doInit()
    expect(getAppEdition()).toBe('cn')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://config.cherry-ai.com/v1/region')
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
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(Response.json({ region: 'GLOBAL' }))
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
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValueOnce(Response.json({ region: 'GLOBAL' }))
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
