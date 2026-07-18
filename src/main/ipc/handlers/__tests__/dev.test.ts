import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isPackagedMock, resetMock } = vi.hoisted(() => ({
  isPackagedMock: vi.fn(() => false),
  resetMock: vi.fn(async () => ({ ok: true as const, restartRequired: true as const }))
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedMock()
    }
  }
}))

vi.mock('@main/services/DevResetCoordinator', () => ({
  DevResetCoordinator: { reset: resetMock }
}))

import { ipcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'

import { IpcRouter } from '../../IpcRouter'
import { ipcHandlers } from '../ipcHandlers'

describe('dev.reset_app_data route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPackagedMock.mockReturnValue(false)
  })

  it('is registered in the global schema and handler maps', () => {
    expect(ipcRequestSchemas['dev.reset_app_data']).toBeDefined()
    expect(ipcHandlers['dev.reset_app_data']).toBeTypeOf('function')
  })

  it('refuses packaged builds with DEV_ONLY', async () => {
    isPackagedMock.mockReturnValue(true)
    await expect(ipcHandlers['dev.reset_app_data'](undefined, { senderId: null })).rejects.toMatchObject({
      code: 'DEV_ONLY'
    })
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('delegates to DevResetCoordinator in development', async () => {
    await expect(ipcHandlers['dev.reset_app_data'](undefined, { senderId: null })).resolves.toEqual({
      ok: true,
      restartRequired: true
    })
    expect(resetMock).toHaveBeenCalledOnce()
  })

  it('dispatches through the global IpcApi schema and handler registries', async () => {
    const router = new IpcRouter(ipcRequestSchemas, ipcHandlers)

    await expect(router.dispatch('dev.reset_app_data', undefined, { senderId: null })).resolves.toEqual({
      ok: true,
      restartRequired: true
    })
    expect(resetMock).toHaveBeenCalledOnce()
  })
})
