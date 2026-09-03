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

import { CherryCloudLoginUnavailableError } from '@main/services/cherryCloud/CherryCloudService'
import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { cherryCloudHandlers } from '../cherryCloud'

describe('cherryCloudHandlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps an unavailable login service to a stable IPC error', async () => {
    service.startLogin.mockRejectedValueOnce(new CherryCloudLoginUnavailableError())

    const error = await cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' }).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE)
  })
})
