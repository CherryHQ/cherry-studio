import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({ startLogin: vi.fn(), openAccountPortal: vi.fn() }))
const track = vi.hoisted(() => vi.fn())
vi.mock('@application', () => ({ application: { get: () => service } }))
vi.mock('@main/services/cherryCloud/subscriptionAnalytics', () => ({ trackCherryCloudAnalyticsEvent: track }))

import {
  CherryCloudLoginUnavailableError,
  CherryCloudUpgradeRequiredError
} from '@main/services/cherryCloud/CherryCloudService'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { cherryCloudHandlers } from '../cherryCloud'

describe('cherryCloudHandlers', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([
    [new CherryCloudLoginUnavailableError(), cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE],
    [new CherryCloudUpgradeRequiredError(), cherryCloudErrorCodes.UPGRADE_REQUIRED]
  ])('preserves typed login failures across IPC: %s', async (failure, code) => {
    service.startLogin.mockRejectedValueOnce(failure)
    const error = await cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' }).catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', code)
  })
  it('passes only trusted sender identity to the portal owner', async () => {
    service.openAccountPortal.mockResolvedValue({ outcome: 'superseded' })
    const input = { scopeId: 'old', entrySource: 'settings' as const }
    await expect(cherryCloudHandlers['cherry_cloud.account_portal.open'](input, { senderId: null })).resolves.toEqual({
      outcome: 'superseded'
    })
    expect(service.openAccountPortal).toHaveBeenCalledWith(input, null)
  })
  it('retains the expected scope at the Cloud analytics boundary', async () => {
    const payload = { event: 'subscription_entry_view' as const, source: 'settings' as const }
    await cherryCloudHandlers['cherry_cloud.analytics.track']({ payload, scopeId: 'scope-1' }, { senderId: 'w1' })
    expect(track).toHaveBeenCalledWith(payload, 'scope-1')
  })
})
