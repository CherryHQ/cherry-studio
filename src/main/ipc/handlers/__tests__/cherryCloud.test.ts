import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  startLogin: vi.fn(),
  getStatus: vi.fn()
}))
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'CherryCloudService') return service
      if (name === 'AnalyticsService') return analytics
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

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
  ])('preserves the login error code %s across IPC', async (failure, code) => {
    service.startLogin.mockRejectedValueOnce(failure)

    const error = await cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' }).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', code)
  })

  it('reports a subscription event with snake_case fields under the signed-in account', async () => {
    service.getStatus.mockResolvedValue({ phase: 'signed-in', accountId: 'account-1', displayName: null })
    await cherryCloudHandlers['cherry_cloud.analytics.track'](
      {
        event: 'subscription_entry_clicked',
        source: 'selector_locked_row',
        flowId: '5f0c6c1e-8b1a-4d7e-9f3a-2b6c1d0e4a77',
        signedIn: true,
        modelId: 'kimi-k2'
      },
      { senderId: 'w1' }
    )

    expect(analytics.trackEvent).toHaveBeenCalledWith(
      'subscription_entry_clicked',
      {
        source: 'selector_locked_row',
        flow_id: '5f0c6c1e-8b1a-4d7e-9f3a-2b6c1d0e4a77',
        signed_in: true,
        model_id: 'kimi-k2'
      },
      'account-1'
    )
  })
})
