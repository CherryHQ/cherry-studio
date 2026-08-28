import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDev: false,
  isLinux: false,
  isMac: false,
  isPortable: true,
  isWin: true,
  setLoginItemSettings: vi.fn()
}))

vi.mock('@main/core/platform', () => ({
  get isDev() {
    return mocks.isDev
  },
  get isLinux() {
    return mocks.isLinux
  },
  get isMac() {
    return mocks.isMac
  },
  get isPortable() {
    return mocks.isPortable
  },
  get isWin() {
    return mocks.isWin
  }
}))
vi.mock('electron', () => ({
  app: { setLoginItemSettings: mocks.setLoginItemSettings }
}))

import { AppService } from '../AppService'

describe('AppService.setAppLaunchOnBoot', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'D:\\Apps\\Cherry Studio Portable.exe')
    mocks.isLinux = false
    mocks.isMac = false
    mocks.isPortable = true
    mocks.isWin = true
  })

  it('registers the stable launcher for Windows portable builds', async () => {
    await new AppService().setAppLaunchOnBoot(true)

    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: 'D:\\Apps\\Cherry Studio Portable.exe',
      args: []
    })
  })

  it('uses Electron defaults for installed Windows builds', async () => {
    mocks.isPortable = false

    await new AppService().setAppLaunchOnBoot(false)

    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('uses Electron defaults on macOS', async () => {
    mocks.isMac = true
    mocks.isPortable = false
    mocks.isWin = false

    await new AppService().setAppLaunchOnBoot(true)

    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
  })
})
