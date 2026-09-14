import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  startLogin: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'CherryCloudService') return service
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
})
