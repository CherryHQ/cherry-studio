import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setLoginItemSettingsMock } = vi.hoisted(() => ({
  setLoginItemSettingsMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { setLoginItemSettings: setLoginItemSettingsMock }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

vi.mock('@application', () => ({
  application: { getPath: vi.fn() }
}))

const platform = vi.hoisted(() => ({ isWin: true, isMac: false, isLinux: false, isDev: false }))
vi.mock('@main/core/platform', () => platform)

import { AppService } from '../AppService'

describe('AppService.setAppLaunchOnBoot on Windows', () => {
  const PORTABLE_PATH = 'D:\\Tools\\Cherry-Studio-1.9.12-portable.exe'

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PORTABLE_EXECUTABLE_FILE
  })

  it('registers the stable launcher path for portable builds', async () => {
    process.env.PORTABLE_EXECUTABLE_FILE = PORTABLE_PATH

    await new AppService().setAppLaunchOnBoot(true)

    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true, path: PORTABLE_PATH })
  })

  it('keeps the default behavior for installed builds', async () => {
    await new AppService().setAppLaunchOnBoot(true)

    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('disables launch through the portable path too', async () => {
    process.env.PORTABLE_EXECUTABLE_FILE = PORTABLE_PATH

    await new AppService().setAppLaunchOnBoot(false)

    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: false, path: PORTABLE_PATH })
  })
})
