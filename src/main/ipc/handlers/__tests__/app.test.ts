import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  appGetPathMock,
  browserWindowGetAllWindowsMock,
  defaultSessionMock,
  requestRelocationMock,
  webviewSessionMock,
  windowSessionMock
} = vi.hoisted(() => {
  const createSessionMock = () => ({
    flushStorageData: vi.fn(),
    cookies: {
      flushStore: vi.fn().mockResolvedValue(undefined)
    },
    closeAllConnections: vi.fn().mockResolvedValue(undefined)
  })

  return {
    appGetMock: vi.fn(),
    appGetPathMock: vi.fn(),
    browserWindowGetAllWindowsMock: vi.fn(),
    defaultSessionMock: createSessionMock(),
    requestRelocationMock: vi.fn(),
    webviewSessionMock: createSessionMock(),
    windowSessionMock: createSessionMock()
  }
})
vi.mock('@application', () => ({ application: { get: appGetMock, getPath: appGetPathMock } }))
vi.mock('@main/core/preboot/userDataLocation', () => ({
  requestRelocation: requestRelocationMock
}))
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: browserWindowGetAllWindowsMock
  },
  session: {
    defaultSession: defaultSessionMock,
    fromPartition: vi.fn((partition: string) => {
      if (partition === 'persist:webview') return webviewSessionMock
      throw new Error(`Unexpected session.fromPartition(${partition})`)
    })
  }
}))

import { appHandlers } from '../app'

const appUpdaterService = {
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  browserWindowGetAllWindowsMock.mockReturnValue([])
  appGetPathMock.mockImplementation((name: string) => {
    if (name === 'app.userdata') return '/current/user/data'
    throw new Error(`Unexpected application.getPath(${name})`)
  })
  appGetMock.mockImplementation((name: string) => {
    if (name === 'AppUpdaterService') return appUpdaterService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// app handlers ignore IpcContext (app-level, not window-scoped), so senderId is
// irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('appHandlers', () => {
  it('check_for_update delegates to AppUpdaterService and passes the result through', async () => {
    const updateInfo = { version: '2.0.0' }
    appUpdaterService.checkForUpdates.mockResolvedValue({ currentVersion: '1.0.0', updateInfo })

    const result = await appHandlers['app.updater.check_for_update'](undefined, ctx)

    expect(appUpdaterService.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ currentVersion: '1.0.0', updateInfo })
  })

  it('check_for_update normalizes a SemVer currentVersion to a plain string', async () => {
    // autoUpdater.currentVersion is a SemVer; only its string form survives the
    // IPC contract, so the handler must coerce it.
    const semverLike = { toString: () => '1.2.3' }
    appUpdaterService.checkForUpdates.mockResolvedValue({ currentVersion: semverLike, updateInfo: null })

    const result = await appHandlers['app.updater.check_for_update'](undefined, ctx)

    expect(result).toEqual({ currentVersion: '1.2.3', updateInfo: null })
    expect(typeof result.currentVersion).toBe('string')
  })

  it('quit_and_install delegates to AppUpdaterService and resolves void', async () => {
    const result = await appHandlers['app.updater.quit_and_install'](undefined, ctx)

    expect(appUpdaterService.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(result).toBeUndefined()
  })

  it('set_user_data_path requests switch-only relocation persistence', async () => {
    const targetPath = '/new/user/data'

    const result = await appHandlers['app.set_user_data_path']({ path: targetPath, copyData: false }, ctx)

    expect(result).toBeUndefined()
    expect(requestRelocationMock).toHaveBeenCalledWith('/current/user/data', targetPath, false)
  })

  it('set_user_data_path copyData=true requests copy relocation persistence', async () => {
    const targetPath = '/new/user/data-copy'

    const result = await appHandlers['app.set_user_data_path']({ path: targetPath, copyData: true }, ctx)

    expect(result).toBeUndefined()
    expect(requestRelocationMock).toHaveBeenCalledWith('/current/user/data', targetPath, true)
  })

  it('set_user_data_path copyData=true flushes app data sessions before requesting copy relocation', async () => {
    const targetPath = '/new/user/data-copy'
    browserWindowGetAllWindowsMock.mockReturnValue([{ webContents: { session: windowSessionMock } }])

    await appHandlers['app.set_user_data_path']({ path: targetPath, copyData: true }, ctx)

    expect(defaultSessionMock.flushStorageData).toHaveBeenCalledTimes(1)
    expect(defaultSessionMock.cookies.flushStore).toHaveBeenCalledTimes(1)
    expect(defaultSessionMock.closeAllConnections).toHaveBeenCalledTimes(1)
    expect(webviewSessionMock.flushStorageData).toHaveBeenCalledTimes(1)
    expect(webviewSessionMock.cookies.flushStore).toHaveBeenCalledTimes(1)
    expect(webviewSessionMock.closeAllConnections).toHaveBeenCalledTimes(1)
    expect(windowSessionMock.flushStorageData).toHaveBeenCalledTimes(1)
    expect(windowSessionMock.cookies.flushStore).toHaveBeenCalledTimes(1)
    expect(windowSessionMock.closeAllConnections).toHaveBeenCalledTimes(1)

    expect(windowSessionMock.closeAllConnections.mock.invocationCallOrder[0]).toBeLessThan(
      requestRelocationMock.mock.invocationCallOrder[0]
    )
  })

  it('set_user_data_path copyData=false skips app data session flush', async () => {
    const targetPath = '/new/user/data'

    await appHandlers['app.set_user_data_path']({ path: targetPath, copyData: false }, ctx)

    expect(defaultSessionMock.flushStorageData).not.toHaveBeenCalled()
    expect(defaultSessionMock.cookies.flushStore).not.toHaveBeenCalled()
    expect(defaultSessionMock.closeAllConnections).not.toHaveBeenCalled()
    expect(webviewSessionMock.flushStorageData).not.toHaveBeenCalled()
    expect(webviewSessionMock.cookies.flushStore).not.toHaveBeenCalled()
    expect(webviewSessionMock.closeAllConnections).not.toHaveBeenCalled()
    expect(browserWindowGetAllWindowsMock).not.toHaveBeenCalled()
  })
})
