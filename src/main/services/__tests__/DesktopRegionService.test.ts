import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { cherryAccountCredentialStore } from '@main/services/cherryCloud/CherryAccountCredentialStore'
import { getAppEdition } from '@main/utils/appEdition'

import { DesktopRegionService, inferDesktopEdition } from '../DesktopRegionService'

describe('DesktopRegionService', () => {
  const db = setupTestDatabase()

  beforeEach(() => {
    vi.stubEnv('CHERRY_UNIFIED_RELEASE', '1')
    MockApplicationUtils.setService('ProxyService', { getAppliedSnapshot: async () => ({ converged: true }) })
    vi.spyOn(cherryAccountCredentialStore, 'get').mockReturnValue(null)
    db.db.delete(appStateTable).where(eq(appStateTable.key, 'desktop.region')).run()
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

  it('keeps the provisional region until the confirmed result can apply on a later launch', async () => {
    db.db
      .insert(appStateTable)
      .values({ key: 'desktop.region', value: { region: 'cn', source: 'local' } })
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
