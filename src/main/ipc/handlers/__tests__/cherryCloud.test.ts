import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  cancelLogin: vi.fn(),
  getStatus: vi.fn(),
  revokeCurrentSession: vi.fn(),
  startLogin: vi.fn(),
  syncEntitledModelsIfStale: vi.fn()
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

  it('returns only the public login status', async () => {
    service.getStatus.mockResolvedValue({ phase: 'signed-in', displayName: 'Sora' })

    await expect(cherryCloudHandlers['cherry_cloud.status.get'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'signed-in',
      displayName: 'Sora'
    })
  })

  it('starts login through the lifecycle service', async () => {
    service.startLogin.mockResolvedValue({ phase: 'authorizing', displayName: null })

    await expect(cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'authorizing',
      displayName: null
    })
  })

  it('cancels the active login through the lifecycle service', async () => {
    service.cancelLogin.mockResolvedValue({ phase: 'signed-out', displayName: null })

    await expect(cherryCloudHandlers['cherry_cloud.login.cancel'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'signed-out',
      displayName: null
    })
  })

  it('revokes the current Session through the lifecycle service', async () => {
    service.revokeCurrentSession.mockResolvedValue({ phase: 'signed-out', displayName: null })

    await expect(cherryCloudHandlers['cherry_cloud.session.revoke'](undefined, { senderId: 'w1' })).resolves.toEqual({
      phase: 'signed-out',
      displayName: null
    })
  })

  it('syncs the signed-in entitled model catalog', async () => {
    service.syncEntitledModelsIfStale.mockResolvedValue({
      entitledModelIds: ['cherry-cloud::deepseek-free', 'cherry-cloud::deepseek-go'],
      quotaExhaustedModelIds: ['cherry-cloud::deepseek-free']
    })

    await expect(cherryCloudHandlers['cherry_cloud.models.sync'](undefined, { senderId: 'w1' })).resolves.toEqual({
      entitledModelIds: ['cherry-cloud::deepseek-free', 'cherry-cloud::deepseek-go'],
      quotaExhaustedModelIds: ['cherry-cloud::deepseek-free']
    })
  })

  it('maps an unavailable login service to a stable IPC error', async () => {
    service.startLogin.mockRejectedValueOnce(new CherryCloudLoginUnavailableError())

    const error = await cherryCloudHandlers['cherry_cloud.login.start'](undefined, { senderId: 'w1' }).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE)
  })
})
