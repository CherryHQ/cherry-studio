import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, appGetPathMock, appRelaunchMock, bootConfigSetMock, bootConfigPersistMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  appGetPathMock: vi.fn(),
  appRelaunchMock: vi.fn(),
  bootConfigSetMock: vi.fn(),
  bootConfigPersistMock: vi.fn()
}))
vi.mock('@application', () => ({
  application: { get: appGetMock, getPath: appGetPathMock, relaunch: appRelaunchMock }
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { set: bootConfigSetMock, persist: bootConfigPersistMock }
}))

import { appHandlers } from '../app'

const appUpdaterService = {
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'AppUpdaterService') return appUpdaterService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// app handlers ignore IpcContext (app-level, not window-scoped), so senderId is
// irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('appHandlers', () => {
  it('check_for_update triggers the AppUpdaterService check and resolves void (results arrive via events)', async () => {
    appUpdaterService.checkForUpdates.mockResolvedValue({ currentVersion: '1.0.0', updateInfo: null })

    const result = await appHandlers['app.updater.check_for_update'](undefined, ctx)

    expect(appUpdaterService.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('quit_and_install delegates to AppUpdaterService and resolves void', async () => {
    const result = await appHandlers['app.updater.quit_and_install'](undefined, ctx)

    expect(appUpdaterService.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  describe('factory_reset.request', () => {
    it('stages the pending marker for the current userData, persists it, then relaunches', async () => {
      appGetPathMock.mockReturnValue('/mock/userData')

      await appHandlers['app.factory_reset.request'](undefined, ctx)

      expect(bootConfigSetMock).toHaveBeenCalledWith(
        'temp.factory_reset',
        expect.objectContaining({ status: 'pending', userDataPath: '/mock/userData' })
      )
      // Durability ordering: the marker must be on disk before the relaunch fires.
      expect(bootConfigPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
        appRelaunchMock.mock.invocationCallOrder[0]
      )
    })

    it('rejects without relaunching when the marker cannot be persisted', async () => {
      appGetPathMock.mockReturnValue('/mock/userData')
      bootConfigPersistMock.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      await expect(appHandlers['app.factory_reset.request'](undefined, ctx)).rejects.toThrow('EACCES')
      expect(appRelaunchMock).not.toHaveBeenCalled()
    })
  })
})
