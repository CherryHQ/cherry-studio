import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  startLogin: vi.fn(),
  cancelLogin: vi.fn()
}))

import {
  CherryCloudLoginUnavailableError,
  CherryCloudSignInFailureError,
  CherryCloudUpgradeRequiredError
} from '@main/services/cherryCloud/CherryCloudService'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { cherryCloudHandlers } from '../cherryCloud'

describe('cherryCloudHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockApplicationUtils.setService('CherryCloudService', service)
  })
  afterEach(() => MockApplicationUtils.resetServices())

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
  it.each([
    ['cherry_cloud.login.start', service.startLogin, 'authorization'],
    ['cherry_cloud.login.cancel', service.cancelLogin, undefined]
  ] as const)('redacts unknown synchronous failures from %s', async (route, invoke, phase) => {
    invoke.mockImplementationOnce(() => {
      throw new TypeError('TOKEN_MARKER')
    })
    const caught = await cherryCloudHandlers[route](undefined, { senderId: 'w1' }).catch((error: unknown) => error)
    expect(IpcError.from(caught).toJSON()).toEqual({
      code: 'CHERRY_CLOUD_SIGN_IN_FAILED',
      message: 'Cherry Cloud sign-in failed',
      data: phase ? { reason: 'unknown', phase } : { reason: 'unknown' }
    })
  })

  it.each(['cherry_cloud.login.start', 'cherry_cloud.login.cancel'] as const)(
    'carries safe classified data for %s',
    async (route) => {
      const invoke = route === 'cherry_cloud.login.start' ? service.startLogin : service.cancelLogin
      invoke.mockRejectedValueOnce(
        new CherryCloudSignInFailureError({ reason: 'browser_open_failed', phase: 'callback' })
      )
      const caught = await cherryCloudHandlers[route](undefined, { senderId: 'w1' }).catch((error: unknown) => error)
      expect(IpcError.from(caught).toJSON()).toEqual({
        code: 'CHERRY_CLOUD_SIGN_IN_FAILED',
        message: 'Cherry Cloud sign-in failed',
        data: { reason: 'browser_open_failed', phase: 'callback' }
      })
    }
  )
})
