import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

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
})
