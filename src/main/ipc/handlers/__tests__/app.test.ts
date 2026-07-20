import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  appGetPathMock,
  appRelaunchMock,
  relaunchAfterShutdownMock,
  bootConfigGetMock,
  bootConfigSetMock,
  bootConfigPersistMock,
  inspectTargetMock,
  requestRelocationMock,
  defaultSession,
  webviewSession
} = vi.hoisted(() => {
  const makeSession = () => ({
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearAuthCache: vi.fn().mockResolvedValue(undefined)
  })
  return {
    appGetMock: vi.fn(),
    appGetPathMock: vi.fn(),
    appRelaunchMock: vi.fn(),
    relaunchAfterShutdownMock: vi.fn(),
    bootConfigGetMock: vi.fn(),
    bootConfigSetMock: vi.fn(),
    bootConfigPersistMock: vi.fn(),
    inspectTargetMock: vi.fn(),
    requestRelocationMock: vi.fn(),
    defaultSession: makeSession(),
    webviewSession: makeSession()
  }
})

vi.mock('@application', () => ({
  application: {
    get: appGetMock,
    getPath: appGetPathMock,
    relaunch: appRelaunchMock,
    relaunchAfterShutdown: relaunchAfterShutdownMock
  }
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { get: bootConfigGetMock, set: bootConfigSetMock, persist: bootConfigPersistMock }
}))
vi.mock('@main/i18n', () => ({ t: (key: string) => key, getAppLanguage: () => 'zh-CN' }))
vi.mock('@main/services/userDataRelocation', () => ({
  inspectUserDataRelocationTarget: inspectTargetMock,
  requestUserDataRelocation: requestRelocationMock
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] },
  dialog: { showMessageBox: vi.fn() },
  session: {
    defaultSession,
    fromPartition: vi.fn(() => webviewSession)
  }
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

    it('stages the pending marker for the current userData, persists it, then gracefully relaunches', async () => {
      appGetPathMock.mockReturnValue('/mock/userData')

      await appHandlers['app.factory_reset.request'](undefined, ctx)

      expect(bootConfigSetMock).toHaveBeenCalledWith(
        'temp.factory_reset',
        expect.objectContaining({
          status: 'pending',
          userDataPath: '/mock/userData',
          // realpath cannot resolve the mock path — falls back to the lexical resolve.
          canonicalPath: '/mock/userData',
          // The gate renders its dialogs in the requesting user's language.
          locale: 'zh-CN'
        })
      )
      // Durability ordering: the marker must be on disk before the relaunch fires.
      expect(bootConfigPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
        relaunchAfterShutdownMock.mock.invocationCallOrder[0]
      )
      // Graceful shutdown-then-relaunch, not the bare relaunch: running
      // services must release file handles before the gate's wipe.
      expect(appRelaunchMock).not.toHaveBeenCalled()
    })

    it('clears Chromium storage of both Cherry sessions after the marker is durable', async () => {
      await appHandlers['app.factory_reset.request'](undefined, ctx)

      for (const s of [defaultSession, webviewSession]) {
        expect(s.clearCache).toHaveBeenCalledTimes(1)
        expect(s.clearStorageData).toHaveBeenCalledTimes(1)
        expect(s.clearAuthCache).toHaveBeenCalledTimes(1)
        // Ordering: the semantic clear runs only on a durably staged marker —
        // a failed persist must not half-clear a session the user keeps using.
        expect(bootConfigPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
          s.clearStorageData.mock.invocationCallOrder[0]
        )
      }
    })

    it('still relaunches when the Chromium clear fails — the gate is the deterministic layer', async () => {
      defaultSession.clearStorageData.mockRejectedValueOnce(new Error('session gone'))

      await expect(appHandlers['app.factory_reset.request'](undefined, ctx)).resolves.toBeUndefined()
      expect(relaunchAfterShutdownMock).toHaveBeenCalledTimes(1)
    })

    it('rolls the marker back and rejects without relaunching when persist fails', async () => {
      appGetPathMock.mockReturnValue('/mock/userData')
      bootConfigGetMock.mockReturnValue(null)
      bootConfigPersistMock.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      await expect(appHandlers['app.factory_reset.request'](undefined, ctx)).rejects.toThrow('EACCES')

      // The dirty in-memory marker is restored to its previous value, so a
      // later flush (e.g. during shutdown) cannot stage the failed request.
      expect(bootConfigSetMock).toHaveBeenLastCalledWith('temp.factory_reset', null)
      expect(relaunchAfterShutdownMock).not.toHaveBeenCalled()
      expect(defaultSession.clearStorageData).not.toHaveBeenCalled()
    })
  })
})
