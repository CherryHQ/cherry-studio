import { createServer, type Server } from 'node:http'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'

import { BlacklistSubscriptionService } from '../BlacklistSubscriptionService'
import { mergeWebSearchBlacklist, toExcludedSiteDomains } from '../utils/blacklist'

// Real HTTP transport catches failures hidden by a fetch mock: error statuses,
// response limits, private-network gating and source publication after parsing.
describe('BlacklistSubscriptionService HTTP integration', () => {
  let server: Server, url: string, body: string, status: number
  let subscriptions: WebSearchBlacklistSubscription[], allowPrivate: boolean
  let service: BlacklistSubscriptionService
  beforeEach(async () => {
    BaseService.resetInstances()
    subscriptions = []
    allowPrivate = true
    status = 200
    body = '# community list\n*://*.spam.example/*\n/ads/\ninvalid line\n'
    server = createServer((_request, response) => {
      response.writeHead(status, { 'Content-Length': Buffer.byteLength(body) })
      response.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/blacklist.txt`
    MockApplicationUtils.setService('PreferenceService', {
      get: (key: string) => (key === 'app.fetch.allow_private_network' ? allowPrivate : subscriptions),
      set: async (_key: string, value: WebSearchBlacklistSubscription[]) => {
        subscriptions = value
      }
    })
    MockApplicationUtils.setService('ProxyService', { getRemoteFetchProxy: async () => undefined })
    service = new BlacklistSubscriptionService()
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('fetches, filters, refreshes offline-safely, and removes only subscription rules', async () => {
    const added = await service.add(url)
    expect(added.rules).toEqual(['*://*.spam.example/*', '/ads/'])
    expect(subscriptions).toEqual([added])
    const manual = ['*://*.manual.example/*']
    expect(toExcludedSiteDomains(mergeWebSearchBlacklist(manual, subscriptions))).toEqual([
      'manual.example',
      'spam.example'
    ])
    status = 503
    const failed = await service.refresh(added.id)
    expect(failed.lastError).toContain('503')
    expect(failed.rules).toEqual(added.rules)
    status = 200
    body = '*://*.new.example/*\n'
    const refreshed = await service.refresh(added.id)
    expect(refreshed.rules).toEqual(['*://*.new.example/*'])
    expect(refreshed.lastError).toBeUndefined()
    await service.remove(added.id)
    expect(mergeWebSearchBlacklist(manual, subscriptions)).toEqual(manual)
  })

  it('does not persist private-network or oversized responses that fail transport validation', async () => {
    allowPrivate = false
    await expect(service.add(url)).rejects.toThrow()
    expect(subscriptions).toEqual([])
    allowPrivate = true
    body = 'x'.repeat(2 * 1024 * 1024 + 1)
    await expect(service.add(url)).rejects.toThrow(/too large/)
    expect(subscriptions).toEqual([])
  })
})
