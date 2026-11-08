import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { toast } from '@renderer/services/toast'
import type { CherryCloudLoginResult, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { CherryCloudSubscriptionService } from '../CherryCloudSubscriptionService'

const request = vi.mocked(window.api.ipcApi.request)
const signedOut: CherryCloudStatus = {
  phase: 'signed-out',
  accountId: null,
  displayName: null,
  scopeId: 'out',
  revision: 1
}
const signedIn: CherryCloudStatus = {
  phase: 'signed-in',
  accountId: 'a',
  displayName: null,
  scopeId: 'in',
  revision: 2
}
let status: CherryCloudStatus
let login: ReturnType<typeof Promise.withResolvers<CherryCloudLoginResult>>
const portals = () => request.mock.calls.filter(([route]) => route === 'cherry_cloud.account_portal.open')
const tracked = () =>
  request.mock.calls
    .filter(([route]) => route === 'cherry_cloud.analytics.track')
    .flatMap(([, input]) => (input && typeof input === 'object' && 'payload' in input ? [input.payload] : []))

beforeEach(() => {
  vi.clearAllMocks()
  status = signedIn
  login = Promise.withResolvers<CherryCloudLoginResult>()
  request.mockImplementation(async (route) => {
    if (route === 'cherry_cloud.status.get') return { ok: true, data: status }
    if (route === 'cherry_cloud.login.start') return { ok: true, data: await login.promise }
    if (route === 'cherry_cloud.account_portal.open') return { ok: true, data: { outcome: 'opened' } }
    return { ok: true, data: undefined }
  })
})

describe('CherryCloudSubscriptionService', () => {
  it('opens a scoped portal and dismisses the Subscribe dot', async () => {
    const service = new CherryCloudSubscriptionService()
    await expect(service.start('settings')).resolves.toEqual({ outcome: 'portal_invoked' })
    expect(cacheService.getPersist('ui.cherry_cloud.subscribe_prompt_seen')).toBe(true)
    expect(portals()[0]?.[1]).toMatchObject({ scopeId: 'in', entrySource: 'settings', flowId: expect.any(String) })
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.login.start')).toBe(false)
  })
  it('uses the one terminal login result to open a portal once', async () => {
    status = signedOut
    const service = new CherryCloudSubscriptionService()
    const pending = service.start('account_panel')
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined))
    login.resolve({ outcome: 'signed-in', status: signedIn })
    await expect(pending).resolves.toEqual({ outcome: 'portal_invoked' })
    expect(portals()).toHaveLength(1)
    expect(
      tracked().filter(
        (event) =>
          event && typeof event === 'object' && 'event' in event && event.event === 'subscription_sign_in_result'
      )
    ).toEqual([{ event: 'subscription_sign_in_result', flowId: expect.any(String), result: 'success' }])
  })
  it('settles replaced intent immediately and ignores its reversed status reply', async () => {
    status = signedOut
    const delayed = Promise.withResolvers<{ ok: true; data: CherryCloudStatus }>()
    request.mockReturnValueOnce(delayed.promise)
    const service = new CherryCloudSubscriptionService()
    const first = service.start('settings')
    const second = service.start('selector_header')
    await expect(first).resolves.toEqual({ outcome: 'not_completed', reason: 'superseded' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined))
    delayed.resolve({ ok: true, data: signedOut })
    login.resolve({ outcome: 'signed-in', status: signedIn })
    await expect(second).resolves.toEqual({ outcome: 'portal_invoked' })
    expect(portals()).toHaveLength(1)
    expect(portals()[0]?.[1]).toHaveProperty('entrySource', 'selector_header')
    expect(
      tracked().filter(
        (event) =>
          event && typeof event === 'object' && 'event' in event && event.event === 'subscription_entry_clicked'
      )
    ).toHaveLength(2)
  })
  it('disposes a pending window intent without cancelling shared authentication', async () => {
    status = signedOut
    const service = new CherryCloudSubscriptionService()
    const pending = service.start('quota_notice')
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined))
    service.dispose()
    await expect(pending).resolves.toEqual({ outcome: 'not_completed', reason: 'disposed' })
    login.resolve({ outcome: 'signed-in', status: signedIn })
    await Promise.resolve()
    expect(portals()).toHaveLength(0)
    expect(request.mock.calls.some(([route]) => route === 'cherry_cloud.login.cancel')).toBe(false)
  })
  it('settles a submitted portal failure even after a newer click opens its portal', async () => {
    const failedPortal = Promise.withResolvers<never>()
    const defaultRequest = request.getMockImplementation()
    let firstPortal = true
    request.mockImplementation((route, input) => {
      if (route === 'cherry_cloud.account_portal.open' && firstPortal) {
        firstPortal = false
        return failedPortal.promise
      }
      return defaultRequest!(route, input)
    })
    const service = new CherryCloudSubscriptionService()
    const first = service.start('settings')
    await vi.waitFor(() => expect(portals()).toHaveLength(1))
    await expect(service.start('selector_header')).resolves.toEqual({ outcome: 'portal_invoked' })
    failedPortal.reject(new Error('browser failed'))
    await expect(first).resolves.toEqual({ outcome: 'failed' })
    expect(tracked()).toContainEqual({
      event: 'subscription_portal_open',
      source: 'settings',
      flowId: expect.any(String),
      result: 'failed'
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
  it('does not open a portal for an explicitly cancelled login', async () => {
    status = signedOut
    const pending = new CherryCloudSubscriptionService().start('settings')
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined))
    login.resolve({ outcome: 'cancelled', status: signedOut })
    await expect(pending).resolves.toEqual({ outcome: 'not_completed', reason: 'cancelled' })
    expect(portals()).toHaveLength(0)
  })
})
