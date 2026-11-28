import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({ startLogin: vi.fn(), startSubscription: vi.fn(), openAmdEntry: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import {
  CherryCloudAmdEntryError,
  CherryCloudLoginUnavailableError,
  CherryCloudPortalOpenError,
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
  it.each([
    [new CherryCloudLoginUnavailableError(), cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE],
    [new CherryCloudUpgradeRequiredError(), cherryCloudErrorCodes.UPGRADE_REQUIRED],
    [new CherryCloudPortalOpenError(new Error('browser failed')), cherryCloudErrorCodes.PORTAL_OPEN_FAILED]
  ])('preserves subscription failure categories across IPC: %s', async (failure, code) => {
    service.startSubscription.mockRejectedValueOnce(failure)
    const input = { source: 'settings' as const, flowId: '00000000-0000-4000-8000-000000000001' }
    const error = await cherryCloudHandlers['cherry_cloud.subscription.start'](input, { senderId: 'w1' }).catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', code)
    expect(service.startSubscription).toHaveBeenCalledWith(input, 'w1')
  })
  it.each([
    [new CherryCloudLoginUnavailableError(), cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE],
    [new CherryCloudAmdEntryError('request failed (404)'), cherryCloudErrorCodes.AMD_ENTRY_FAILED]
  ])('tells the renderer why an AMD entry could not open: %s', async (failure, code) => {
    service.openAmdEntry.mockRejectedValueOnce(failure)
    const error = await cherryCloudHandlers['cherry_cloud.amd_entry.open'](
      { modelId: 'amd/qwen', flowId: '00000000-0000-4000-8000-000000000001' },
      { senderId: 'w1' }
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(IpcError)
    expect(error).toHaveProperty('code', code)
    // The click's flow id reaches the service so its outcome reports under the same flow.
    expect(service.openAmdEntry).toHaveBeenCalledWith('w1', 'amd/qwen', '00000000-0000-4000-8000-000000000001')
  })
})
