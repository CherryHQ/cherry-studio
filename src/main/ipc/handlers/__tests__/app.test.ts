import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  appGetPathMock,
  appRelaunchMock,
  bootConfigSetMock,
  bootConfigPersistMock,
  inspectTargetMock,
  requestRelocationMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  appGetPathMock: vi.fn(),
  appRelaunchMock: vi.fn(),
  bootConfigSetMock: vi.fn(),
  bootConfigPersistMock: vi.fn(),
  inspectTargetMock: vi.fn(),
  requestRelocationMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: appGetMock, getPath: appGetPathMock, relaunch: appRelaunchMock }
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { set: bootConfigSetMock, persist: bootConfigPersistMock }
}))
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))
vi.mock('@main/services/userDataRelocation', () => ({
  inspectUserDataRelocationTarget: inspectTargetMock,
  requestUserDataRelocation: requestRelocationMock
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] },
  dialog: { showMessageBox: vi.fn() }
}))

import { app, dialog } from 'electron'

import { appHandlers } from '../app'

const appUpdaterService = {
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}
const preferenceService = {
  get: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(app as { isPackaged: boolean }).isPackaged = true
  appGetPathMock.mockReturnValue('/mock/path')
  inspectTargetMock.mockReturnValue({ valid: true, targetEmpty: true })
  appGetMock.mockImplementation((name: string) => {
    if (name === 'AppUpdaterService') return appUpdaterService
    if (name === 'PreferenceService') return preferenceService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('appHandlers', () => {
  it('inspects relocation targets through the domain validation', async () => {
    const result = await appHandlers['app.user_data_relocation.inspect']({ path: '/new/data' }, ctx)

    expect(inspectTargetMock).toHaveBeenCalledWith('/new/data')
    expect(result).toEqual({ valid: true, targetEmpty: true })
  })

  it('delegates relocation requests to the domain in packaged builds', async () => {
    const result = await appHandlers['app.user_data_relocation.request']({ path: '/new/data', copy: true }, ctx)

    expect(requestRelocationMock).toHaveBeenCalledWith('/new/data', true)
    expect(result).toBeUndefined()
  })

  it('rejects relocation requests from unpackaged development runs', async () => {
    ;(app as { isPackaged: boolean }).isPackaged = false

    await expect(
      appHandlers['app.user_data_relocation.request']({ path: '/new/data', copy: true }, ctx)
    ).rejects.toMatchObject({ code: 'USER_DATA_RELOCATION_UNAVAILABLE' })
    expect(requestRelocationMock).not.toHaveBeenCalled()
  })

  it('relaunches through IpcApi', async () => {
    await expect(appHandlers['app.relaunch'](undefined, ctx)).resolves.toBeUndefined()
    expect(appRelaunchMock).toHaveBeenCalledOnce()
  })

  it('check_for_update triggers the AppUpdaterService check and resolves void', async () => {
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
    beforeEach(() => {
      // The native confirmation dialog (the arming authority — renderer-side
      // dialogs don't count for a whole-profile wipe): button 1 is confirm.
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false })
    })

    it('resolves without staging anything when the user cancels the native confirmation', async () => {
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })

      await expect(appHandlers['app.factory_reset.request'](undefined, ctx)).resolves.toBeUndefined()

      expect(bootConfigSetMock).not.toHaveBeenCalled()
      expect(bootConfigPersistMock).not.toHaveBeenCalled()
      expect(appRelaunchMock).not.toHaveBeenCalled()
    })

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
