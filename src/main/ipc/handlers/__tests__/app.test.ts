import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  appGetPathMock,
  appRelaunchMock,
  cacheCleanupInspectMock,
  cacheCleanupRunMock,
  deliverToReadyMainMock,
  inspectTargetMock,
  requestDataResetMock,
  requestV1RemigrationMock,
  requestRelocationMock,
  setMainSurfaceReceiverMock,
  showSupportedMessageBoxMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  appGetPathMock: vi.fn(),
  appRelaunchMock: vi.fn(),
  cacheCleanupInspectMock: vi.fn(),
  cacheCleanupRunMock: vi.fn(),
  deliverToReadyMainMock: vi.fn(),
  inspectTargetMock: vi.fn(),
  requestDataResetMock: vi.fn(),
  requestV1RemigrationMock: vi.fn(),
  requestRelocationMock: vi.fn(),
  setMainSurfaceReceiverMock: vi.fn(),
  showSupportedMessageBoxMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock,
    getPath: appGetPathMock,
    relaunch: appRelaunchMock
  }
}))
vi.mock('@main/services/dataReset', () => ({
  requestDataReset: requestDataResetMock,
  requestV1Remigration: requestV1RemigrationMock
}))
vi.mock('@main/services/userDataRelocation', () => ({
  inspectUserDataRelocationTarget: inspectTargetMock,
  requestUserDataRelocation: requestRelocationMock
}))
vi.mock('@main/services/cacheCleanup', () => ({
  cacheCleanupService: { inspect: cacheCleanupInspectMock, run: cacheCleanupRunMock }
}))
vi.mock('@main/services/mainWindowNavigation', () => ({
  deliverToReadyMain: (...args: unknown[]) => deliverToReadyMainMock(...args),
  setMainSurfaceReceiver: (...args: unknown[]) => setMainSurfaceReceiverMock(...args)
}))
vi.mock('@main/core/preboot/nativeErrorDialog', () => ({
  showSupportedMessageBox: (...args: unknown[]) => showSupportedMessageBoxMock(...args)
}))
vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US', getVersion: () => '1.0.0', isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] }
}))

import { app } from 'electron'

import { WindowType } from '@main/core/window/types'

import { appHandlers } from '../app'

const appUpdaterService = {
  checkForUpdates: vi.fn(),
  getReleaseHistory: vi.fn(),
  quitAndInstall: vi.fn()
}
const windowManager = {
  getWindowType: vi.fn(() => WindowType.Main)
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
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
  preferenceService.get.mockReset()
  preferenceService.get.mockReturnValue(undefined)
})

const ctx = { senderId: 'w1' }

const fault = {
  id: 'fault-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  source: 'screenshotWindow',
  operation: 'react.render',
  message: 'overlay failed',
  stack: 'at /Users/private/screenshot.ts:1'
}

describe('appHandlers', () => {
  it('rejects an update handoff when the main window cannot receive it', async () => {
    deliverToReadyMainMock.mockReturnValue(false)

    await expect(appHandlers['app.updater.present_check'](undefined, ctx)).rejects.toMatchObject({
      code: 'MAIN_UNAVAILABLE'
    })
    expect(deliverToReadyMainMock).toHaveBeenCalledWith('app.updater.run_check', undefined)
  })

  it('rejects an error handoff without treating a missed delivery as success', async () => {
    deliverToReadyMainMock.mockReturnValue(false)

    await expect(appHandlers['app.error.handoff'](fault, ctx)).rejects.toMatchObject({ code: 'MAIN_UNAVAILABLE' })
    expect(deliverToReadyMainMock).toHaveBeenCalledWith('app.error.open', fault)
  })

  it('shows a native dialog for a degraded error and keeps the stack off the primary message', async () => {
    showSupportedMessageBoxMock.mockResolvedValue(0)

    await appHandlers['app.error.degraded'](fault, ctx)

    const input = showSupportedMessageBoxMock.mock.calls[0][0] as {
      box: { message: string }
      technicalDetail: string
    }
    expect(input.box).toEqual(expect.objectContaining({ buttons: ['Close'] }))
    expect(input.technicalDetail).toContain('overlay failed')
    expect(input.technicalDetail).toContain('/Users/private')
    expect(JSON.stringify(input.box)).not.toContain('/Users/private')
  })

  it('uses one app language for the degraded dialog when it differs from the OS locale', async () => {
    preferenceService.get.mockImplementation((key: string) => (key === 'app.language' ? 'zh-CN' : undefined))
    showSupportedMessageBoxMock.mockResolvedValue(0)

    await appHandlers['app.error.degraded'](fault, ctx)

    expect(app.getLocale()).toBe('en-US')
    expect(preferenceService.get).toHaveBeenCalledTimes(1)
    expect(preferenceService.get).toHaveBeenCalledWith('app.language')
    const input = showSupportedMessageBoxMock.mock.calls[0][0] as {
      language: string
      box: { title: string; message: string; buttons: string[] }
    }
    expect(input.language).toBe('zh-CN')
    expect(input.box).toMatchObject({
      title: '错误',
      message: 'Cherry Studio 无法在主窗口中显示此错误。',
      buttons: ['关闭']
    })
  })

  it('records the main surface receiver and ignores another window', async () => {
    await appHandlers['app.surface.receiver']({ kind: 'error', ready: true }, ctx)
    expect(setMainSurfaceReceiverMock).toHaveBeenCalledWith('error', true)

    setMainSurfaceReceiverMock.mockClear()
    windowManager.getWindowType.mockReturnValueOnce(WindowType.Screenshot)
    await appHandlers['app.surface.receiver']({ kind: 'update', ready: true }, ctx)
    expect(setMainSurfaceReceiverMock).not.toHaveBeenCalled()
  })

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

  it('delegates cache cleanup inspection to the service', async () => {
    const expected = {
      results: [
        {
          group: 'normal_cache' as const,
          size: { bytes: 128, accuracy: 'estimated' as const, completeness: 'complete' as const }
        }
      ]
    }
    cacheCleanupInspectMock.mockResolvedValue(expected)

    const result = await appHandlers['app.cache_cleanup.inspect']({ groups: ['normal_cache'] }, ctx)

    expect(cacheCleanupInspectMock).toHaveBeenCalledWith(['normal_cache'])
    expect(result).toEqual(expected)
  })

  it('delegates cache cleanup execution to the service', async () => {
    const expected = { results: [{ group: 'site_data' as const, status: 'cleared' as const }] }
    cacheCleanupRunMock.mockResolvedValue(expected)

    const result = await appHandlers['app.cache_cleanup.run']({ groups: ['site_data'] }, ctx)

    expect(cacheCleanupRunMock).toHaveBeenCalledWith(['site_data'])
    expect(result).toEqual(expected)
  })

  it('check_for_update triggers the AppUpdaterService check and resolves void', async () => {
    appUpdaterService.checkForUpdates.mockResolvedValue({ currentVersion: '1.0.0', updateInfo: null })

    const result = await appHandlers['app.updater.check_for_update'](undefined, ctx)

    expect(appUpdaterService.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('gets release notes through AppUpdaterService', async () => {
    const releases = [{ releaseNotes: 'New features', version: '1.1.0' }]
    appUpdaterService.getReleaseHistory.mockResolvedValue(releases)

    const result = await appHandlers['app.updater.release_notes.get'](undefined, ctx)

    expect(appUpdaterService.getReleaseHistory).toHaveBeenCalledOnce()
    expect(result).toEqual(releases)
  })

  it('quit_and_install delegates to AppUpdaterService and resolves void', async () => {
    const result = await appHandlers['app.updater.quit_and_install'](undefined, ctx)

    expect(appUpdaterService.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('delegates data reset requests to the owning domain module', async () => {
    const result = await appHandlers['app.data_reset.request'](undefined, ctx)

    expect(requestDataResetMock).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('propagates data reset rejections to the caller', async () => {
    requestDataResetMock.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    await expect(appHandlers['app.data_reset.request'](undefined, ctx)).rejects.toThrow('EACCES')
  })

  it('delegates v1 remigration requests to the owning domain module', async () => {
    const result = await appHandlers['app.migration_v2.rerun'](undefined, ctx)

    expect(requestV1RemigrationMock).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })
})
