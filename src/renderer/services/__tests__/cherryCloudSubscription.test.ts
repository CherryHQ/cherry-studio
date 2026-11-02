import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { startCherryCloudSubscription } from '../cherryCloudSubscription'

const request = vi.mocked(window.api.ipcApi.request)
const signedOut: CherryCloudStatus = { phase: 'signed-out', accountId: null, displayName: null }
const authorizing: CherryCloudStatus = { phase: 'authorizing', accountId: null, displayName: null }
const signedIn: CherryCloudStatus = { phase: 'signed-in', accountId: 'account-1', displayName: 'Siin' }
const PORTAL = 'https://cloud.cherryai.com.cn/account/plans'

let status: CherryCloudStatus
let publishStatus: (next: CherryCloudStatus) => void

beforeEach(() => {
  vi.clearAllMocks()
  cacheService.setPersist('ui.cherry_cloud.subscribe_prompt_seen', false)
  request.mockImplementation(async (route) => {
    if (route === 'cherry_cloud.status.get') return { ok: true, data: status }
    if (route === 'cherry_cloud.login.start') return { ok: true, data: authorizing }
    if (route === 'cherry_cloud.account_origin.get') return { ok: true, data: 'https://cloud.cherryai.com.cn' }
    return { ok: true, data: undefined }
  })
  vi.mocked(window.api.ipcApi.on).mockImplementation((_event, handler) => {
    let subscribed = true
    publishStatus = (next) => subscribed && handler(next)
    return () => {
      subscribed = false
    }
  })
})

const tracked = () =>
  request.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track').map(([, event]) => event)

const portalUrls = () =>
  request.mock.calls
    .filter(([route]) => route === 'system.shell.open_external_website')
    .map(([, url]) => new URL(url as string))
    .filter((url) => `${url.origin}${url.pathname}` === PORTAL)
const portalOpened = () => portalUrls().length > 0

describe('startCherryCloudSubscription', () => {
  it('opens the portal for a signed-in account and dismisses the subscribe prompt', async () => {
    status = signedIn

    await startCherryCloudSubscription('selector_locked_row', { modelId: 'cherryai-subscription::kimi-k2' })

    expect(portalOpened()).toBe(true)
    expect(request).not.toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(cacheService.getPersist('ui.cherry_cloud.subscribe_prompt_seen')).toBe(true)
    const flowId = portalUrls()[0].searchParams.get('flow_id')
    expect(Object.fromEntries(portalUrls()[0].searchParams)).toEqual({
      entry: 'desktop',
      entry_source: 'selector_locked_row',
      flow_id: expect.stringMatching(/^[0-9a-f-]{36}$/)
    })
    expect(tracked()).toEqual([
      {
        event: 'subscription_entry_clicked',
        source: 'selector_locked_row',
        flowId,
        signedIn: true,
        modelId: 'cherryai-subscription::kimi-k2'
      },
      { event: 'subscription_portal_open', source: 'selector_locked_row', flowId, result: 'success' }
    ])
  })

  it('starts a new flow for every Subscribe click', async () => {
    status = signedIn

    await startCherryCloudSubscription('settings')
    await startCherryCloudSubscription('settings')

    const [first, second] = portalUrls().map((url) => url.searchParams.get('flow_id'))
    expect(first).not.toBe(second)
  })

  it('signs in first and opens the portal only once the session arrives', async () => {
    status = signedOut

    await startCherryCloudSubscription('account_panel')

    expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
    expect(portalOpened()).toBe(false)

    publishStatus(signedIn)

    await vi.waitFor(() => expect(portalOpened()).toBe(true))
    const flowId = portalUrls()[0].searchParams.get('flow_id')
    await vi.waitFor(() =>
      expect(tracked()).toEqual([
        { event: 'subscription_entry_clicked', source: 'account_panel', flowId, signedIn: false },
        { event: 'subscription_sign_in_result', flowId, result: 'success' },
        { event: 'subscription_portal_open', source: 'account_panel', flowId, result: 'success' }
      ])
    )
  })

  it('opens the portal once when Subscribe is pressed again while signing in', async () => {
    status = signedOut
    const handlers = new Set<(next: CherryCloudStatus) => void>()
    vi.mocked(window.api.ipcApi.on).mockImplementation((_event, handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    })

    await startCherryCloudSubscription()
    await startCherryCloudSubscription()
    handlers.forEach((handler) => handler(signedIn))

    await vi.waitFor(() => expect(portalOpened()).toBe(true))
    expect(
      request.mock.calls.filter(([route, url]) => route === 'system.shell.open_external_website' && url === PORTAL)
    ).toHaveLength(1)
  })

  it('explains a sign-in rejected because the client must be upgraded', async () => {
    status = signedOut
    request.mockImplementation(async (route) => {
      if (route === 'cherry_cloud.status.get') return { ok: true, data: status }
      if (route === 'cherry_cloud.login.start') {
        return { ok: false, error: { code: cherryCloudErrorCodes.UPGRADE_REQUIRED, message: 'upgrade' } }
      }
      return { ok: true, data: undefined }
    })

    await startCherryCloudSubscription('quota_notice')

    expect(toast.error).toHaveBeenCalledWith(i18n.t('settings.provider.cherry_cloud.upgrade_required'))
    expect(portalOpened()).toBe(false)
    expect(tracked()).toContainEqual({
      event: 'subscription_sign_in_result',
      flowId: expect.any(String),
      result: 'failed',
      reason: 'upgrade_required'
    })
  })

  it('reports a portal that fails to open as such, not as a sign-in failure', async () => {
    status = signedIn
    request.mockImplementation(async (route) => {
      if (route === 'cherry_cloud.status.get') return { ok: true, data: status }
      if (route === 'cherry_cloud.account_origin.get')
        return { ok: false, error: { code: 'INTERNAL', message: 'down' } }
      return { ok: true, data: undefined }
    })

    await startCherryCloudSubscription('settings')

    expect(toast.error).toHaveBeenCalledWith(i18n.t('settings.subscription.open_portal_failed'))
    expect(tracked()).toContainEqual({
      event: 'subscription_portal_open',
      source: 'settings',
      flowId: expect.any(String),
      result: 'failed'
    })
  })

  it('does not open the portal when sign-in is abandoned', async () => {
    status = signedOut

    await startCherryCloudSubscription('selector_header')
    publishStatus(signedOut)
    publishStatus(signedIn)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(portalOpened()).toBe(false)
    expect(tracked()).toContainEqual({
      event: 'subscription_sign_in_result',
      flowId: expect.any(String),
      result: 'cancelled'
    })
    expect(tracked().some((event) => (event as { event: string }).event === 'subscription_portal_open')).toBe(false)
  })
})
