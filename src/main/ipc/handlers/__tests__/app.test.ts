import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, appGetPathMock, assertRequestMock, bootConfigFlushMock, inspectTargetMock, preferenceSetMock } =
  vi.hoisted(() => ({
    appGetMock: vi.fn(),
    appGetPathMock: vi.fn(),
    assertRequestMock: vi.fn(),
    bootConfigFlushMock: vi.fn(),
    inspectTargetMock: vi.fn(),
    preferenceSetMock: vi.fn()
  }))

vi.mock('@application', () => ({ application: { get: appGetMock, getPath: appGetPathMock } }))
vi.mock('@main/core/preboot/userDataRelocationGate', () => ({
  assertUserDataRelocationRequest: assertRequestMock,
  inspectUserDataRelocationTarget: inspectTargetMock
}))
vi.mock('@main/core/preboot/userDataLocation', () => ({ canonicalizeUserDataPath: (value: string) => value }))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { flush: bootConfigFlushMock } }))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] }
}))

import { app } from 'electron'

import { appHandlers } from '../app'

const appUpdaterService = {
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}
const preferenceService = {
  get: vi.fn(),
  set: preferenceSetMock
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(app as { isPackaged: boolean }).isPackaged = true
  appGetPathMock.mockImplementation((key: string) => (key === 'app.userdata' ? '/old/data' : '/mock/path'))
  inspectTargetMock.mockReturnValue({ valid: true, targetExists: true, targetEmpty: true })
  appGetMock.mockImplementation((name: string) => {
    if (name === 'AppUpdaterService') return appUpdaterService
    if (name === 'PreferenceService') return preferenceService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('appHandlers', () => {
  it('inspects relocation targets through the gate validation', async () => {
    const result = await appHandlers['app.inspect_user_data_relocation']({ path: '/new/data' }, ctx)

    expect(inspectTargetMock).toHaveBeenCalledWith('/old/data', '/new/data')
    expect(result).toEqual({ valid: true, targetExists: true, targetEmpty: true })
  })

  it('persists relocation through PreferenceService and flushes before relaunch', async () => {
    const result = await appHandlers['app.request_user_data_relocation'](
      { path: '/new/data', copy: true, overwrite: false },
      ctx
    )

    const pending = {
      status: 'pending',
      from: '/old/data',
      to: '/new/data',
      copy: true,
      overwrite: false
    }
    expect(assertRequestMock).toHaveBeenCalledWith(pending)
    expect(preferenceSetMock).toHaveBeenCalledWith('BootConfig.temp.user_data_relocation', pending)
    expect(bootConfigFlushMock).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('rejects relocation requests from unpackaged development runs', async () => {
    ;(app as { isPackaged: boolean }).isPackaged = false

    await expect(
      appHandlers['app.request_user_data_relocation']({ path: '/new/data', copy: true, overwrite: false }, ctx)
    ).rejects.toMatchObject({ code: 'USER_DATA_RELOCATION_UNAVAILABLE' })
    expect(preferenceSetMock).not.toHaveBeenCalled()
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
})
