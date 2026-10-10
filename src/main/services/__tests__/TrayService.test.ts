import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGetPath: vi.fn(() => 'C:\\Program Files\\Cherry Studio\\Cherry Studio.exe'),
  applicationId: vi.fn(() => 'com.kangfenmao.CherryStudio'),
  normalizedExecutablePath: vi.fn(() => 'C:\\Program Files\\Cherry Studio\\Cherry Studio.exe'),
  platform: { isLinux: false, isMac: false, isPortable: false, isWin: true },
  preferenceGet: vi.fn(() => false),
  trayConstructor: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.appGetPath },
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      resize: vi.fn(() => ({ setTemplateImage: vi.fn() }))
    }))
  },
  nativeTheme: { shouldUseDarkColors: false },
  Tray: class {
    constructor(...args: unknown[]) {
      mocks.trayConstructor(...args)
    }

    on = vi.fn()
    setContextMenu = vi.fn()
    setImage = vi.fn()
    setToolTip = vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => (name === 'PreferenceService' ? { get: mocks.preferenceGet } : {}))
  }
}))

vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {},
  Injectable: () => () => {},
  Phase: { WhenReady: 'whenReady' },
  ServicePhase: () => () => {}
}))

vi.mock('@main/core/platform', () => mocks.platform)
vi.mock('@main/core/preboot/userDataLocation', () => ({
  getNormalizedExecutablePath: mocks.normalizedExecutablePath
}))
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))
vi.mock('@main/utils/appEdition', () => ({ getApplicationId: mocks.applicationId }))

import { TrayService } from '../TrayService'

function activateTray() {
  const service = new TrayService()
  ;(service as unknown as { onActivate: () => void }).onActivate()
}

describe('TrayService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGetPath.mockReturnValue('C:\\Program Files\\Cherry Studio\\Cherry Studio.exe')
    mocks.normalizedExecutablePath.mockReturnValue('C:\\Program Files\\Cherry Studio\\Cherry Studio.exe')
    mocks.applicationId.mockReturnValue('com.kangfenmao.CherryStudio')
    mocks.platform.isWin = true
    mocks.platform.isMac = false
    mocks.platform.isLinux = false
    mocks.platform.isPortable = false
    delete process.env.PORTABLE_EXECUTABLE_DIR
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses a stable tray identity for restarts from the same Windows executable path', () => {
    activateTray()
    const firstGuid = mocks.trayConstructor.mock.calls[0][1]

    activateTray()
    const secondGuid = mocks.trayConstructor.mock.calls[1][1]

    expect(firstGuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(secondGuid).toBe(firstGuid)
  })

  it('uses a new identity when the Windows executable path changes', () => {
    activateTray()
    const firstGuid = mocks.trayConstructor.mock.calls[0][1]

    mocks.appGetPath.mockReturnValue('D:\\Portable Apps\\Cherry Studio.exe')
    mocks.normalizedExecutablePath.mockReturnValue('D:\\Portable Apps\\Cherry Studio.exe')
    activateTray()

    expect(mocks.trayConstructor.mock.calls[1][1]).not.toBe(firstGuid)
  })

  it('uses a stable tray identity for portable Windows when the runtime exe path changes', () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'C:\\Users\\alice\\scoop\\apps\\cherry-studio\\current')
    mocks.platform.isPortable = true
    mocks.normalizedExecutablePath.mockReturnValue(
      'C:\\Users\\alice\\scoop\\apps\\cherry-studio\\current\\cherry-studio-portable.exe'
    )
    mocks.appGetPath
      .mockReturnValueOnce('C:\\Temp\\updater-cache\\app-1\\Cherry Studio.exe')
      .mockReturnValueOnce('C:\\Temp\\updater-cache\\app-2\\Cherry Studio.exe')

    activateTray()
    const firstGuid = mocks.trayConstructor.mock.calls[0][1]

    activateTray()
    const secondGuid = mocks.trayConstructor.mock.calls[1][1]

    expect(firstGuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(secondGuid).toBe(firstGuid)
  })

  it('uses a new portable tray identity when the portable install root moves', () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'D:\\PortableApps\\CherryStudio')
    mocks.platform.isPortable = true
    mocks.normalizedExecutablePath.mockReturnValueOnce('D:\\PortableApps\\CherryStudio\\cherry-studio-portable.exe')

    activateTray()
    const firstGuid = mocks.trayConstructor.mock.calls[0][1]

    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'E:\\Apps\\CherryStudio')
    mocks.normalizedExecutablePath.mockReturnValueOnce('E:\\Apps\\CherryStudio\\cherry-studio-portable.exe')
    activateTray()

    expect(mocks.trayConstructor.mock.calls[1][1]).not.toBe(firstGuid)
  })

  it('does not pass a Windows tray identity on macOS or Linux', () => {
    mocks.platform.isWin = false
    mocks.platform.isMac = true
    activateTray()
    mocks.platform.isMac = false
    mocks.platform.isLinux = true
    activateTray()

    expect(mocks.trayConstructor.mock.calls.map((call) => call.length)).toEqual([1, 1])
  })

  it('keeps tray identities separate between Cherry editions', () => {
    activateTray()
    const globalGuid = mocks.trayConstructor.mock.calls[0][1]

    mocks.applicationId.mockReturnValue('com.cherryai.cherrystudio.cn')
    activateTray()

    expect(mocks.trayConstructor.mock.calls[1][1]).not.toBe(globalGuid)
  })
})
