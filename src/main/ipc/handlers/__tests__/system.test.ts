import { createMockApplication, MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDeviceTypeMock,
  getCountryMock,
  getFontsMock,
  isTrustedMock,
  openPathMock,
  openRequestPathMock,
  openExternalMock,
  isSafeMock,
  nativeThemeMock,
  platform,
  screenCaptureStatusMock,
  requestScreenCaptureMock,
  openScreenCaptureSettingsMock
} = vi.hoisted(() => ({
  getDeviceTypeMock: vi.fn(),
  getCountryMock: vi.fn(),
  getFontsMock: vi.fn(),
  isTrustedMock: vi.fn(),
  openPathMock: vi.fn(),
  openRequestPathMock: vi.fn(),
  openExternalMock: vi.fn(),
  isSafeMock: vi.fn(),
  nativeThemeMock: { shouldUseDarkColors: false },
  platform: { isMac: true },
  screenCaptureStatusMock: vi.fn(),
  requestScreenCaptureMock: vi.fn(),
  openScreenCaptureSettingsMock: vi.fn()
}))

vi.mock('@main/utils/system', () => ({ getDeviceType: getDeviceTypeMock }))
vi.mock('@main/services/RegionService', () => ({ regionService: { getCountry: getCountryMock } }))
vi.mock('@main/services/file', () => ({ openRequestPath: openRequestPathMock }))
vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: isSafeMock }))
vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))
vi.mock('electron', () => ({
  nativeTheme: nativeThemeMock,
  systemPreferences: { isTrustedAccessibilityClient: isTrustedMock },
  shell: { openPath: openPathMock, openExternal: openExternalMock }
}))
vi.mock('font-list', () => ({ default: { getFonts: getFontsMock } }))
// The TCC gate is its own module, not the screenshot barrel: answering a permission
// query must not drag the overlay service into every app launch.
vi.mock('@main/utils/screenCapturePermission', () => ({
  getScreenCapturePermissionStatus: screenCaptureStatusMock,
  requestScreenCapturePermission: requestScreenCaptureMock,
  openScreenCaptureSettings: openScreenCaptureSettingsMock
}))

import { systemRequestSchemas } from '@shared/ipc/schemas/system'

import { systemHandlers } from '../system'

const navigation = createMockApplication().get('MainWindowService') as { openWebsite: (url: string) => Promise<void> }
const webContents = {
  isDevToolsOpened: vi.fn(() => false),
  openDevTools: vi.fn(),
  closeDevTools: vi.fn()
}
const windowManager = {
  getWindow: vi.fn((): { webContents: typeof webContents } | undefined => ({ webContents }))
}

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  platform.isMac = true
  nativeThemeMock.shouldUseDarkColors = false
  MockApplicationUtils.resetServices()
  MockApplicationUtils.setService('WindowManager', windowManager)
  webContents.isDevToolsOpened.mockReturnValue(false)
})

describe('systemHandlers', () => {
  it('get_device_type delegates to the platform util', async () => {
    getDeviceTypeMock.mockReturnValue('mac')
    expect(await systemHandlers['system.get_device_type'](undefined, ctx('w1'))).toBe('mac')
  })

  it('get_native_theme returns Electron resolved theme', async () => {
    expect(await systemHandlers['system.get_native_theme'](undefined, ctx('w1'))).toBe('light')

    nativeThemeMock.shouldUseDarkColors = true
    expect(await systemHandlers['system.get_native_theme'](undefined, ctx('w1'))).toBe('dark')
  })

  it('get_ip_country delegates to RegionService', async () => {
    getCountryMock.mockResolvedValue('US')
    expect(await systemHandlers['system.get_ip_country'](undefined, ctx('w1'))).toBe('US')
  })

  it('get_fonts strips wrapping quotes and drops empties', async () => {
    getFontsMock.mockResolvedValue(['"Arial"', 'Menlo', ''])
    expect(await systemHandlers['system.get_fonts'](undefined, ctx('w1'))).toEqual(['Arial', 'Menlo'])
  })

  it('get_fonts returns [] and never throws when font-list fails', async () => {
    getFontsMock.mockRejectedValue(new Error('boom'))
    expect(await systemHandlers['system.get_fonts'](undefined, ctx('w1'))).toEqual([])
  })

  it('opens the caller window DevTools docked at the bottom', async () => {
    await systemHandlers['system.toggle_dev_tools'](undefined, ctx('w1'))

    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(webContents.openDevTools).toHaveBeenCalledWith({ mode: 'bottom' })
    expect(webContents.closeDevTools).not.toHaveBeenCalled()
  })

  it('closes DevTools when they are already open', async () => {
    webContents.isDevToolsOpened.mockReturnValue(true)

    await systemHandlers['system.toggle_dev_tools'](undefined, ctx('w1'))

    expect(webContents.closeDevTools).toHaveBeenCalledOnce()
    expect(webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('toggle_dev_tools is a no-op without a caller window', async () => {
    await systemHandlers['system.toggle_dev_tools'](undefined, ctx(null))
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })

  it('toggle_dev_tools is a no-op when the caller window is gone', async () => {
    windowManager.getWindow.mockReturnValueOnce(undefined)

    await systemHandlers['system.toggle_dev_tools'](undefined, ctx('closed-window'))

    expect(webContents.openDevTools).not.toHaveBeenCalled()
    expect(webContents.closeDevTools).not.toHaveBeenCalled()
  })

  it('mac.is_process_trusted queries systemPreferences on darwin', async () => {
    isTrustedMock.mockReturnValue(true)
    expect(await systemHandlers['system.mac.is_process_trusted'](undefined, ctx('w1'))).toBe(true)
    expect(isTrustedMock).toHaveBeenCalledWith(false)
  })

  it('mac.request_process_trust prompts on darwin', async () => {
    isTrustedMock.mockReturnValue(false)
    expect(await systemHandlers['system.mac.request_process_trust'](undefined, ctx('w1'))).toBe(false)
    expect(isTrustedMock).toHaveBeenCalledWith(true)
  })

  it('mac.* routes are resident and return false off darwin without touching systemPreferences', async () => {
    platform.isMac = false
    expect(await systemHandlers['system.mac.is_process_trusted'](undefined, ctx('w1'))).toBe(false)
    expect(await systemHandlers['system.mac.request_process_trust'](undefined, ctx('w1'))).toBe(false)
    expect(isTrustedMock).not.toHaveBeenCalled()
  })

  it('mac.screen_capture_status reports the OS permission state to the renderer', async () => {
    screenCaptureStatusMock.mockReturnValue('denied')
    expect(await systemHandlers['system.mac.screen_capture_status'](undefined, ctx('w1'))).toBe('denied')
  })

  // The settings UI branches on this to choose between "restart to apply", "open System Settings"
  // and "the prompt never appeared"; a PRE-prompt status (or void) makes those indistinguishable.
  it('mac.request_screen_capture answers with the status observed after prompting', async () => {
    requestScreenCaptureMock.mockResolvedValue('authorized')
    expect(await systemHandlers['system.mac.request_screen_capture'](undefined, ctx('w1'))).toBe('authorized')
  })

  it('mac.request_screen_capture reports denial rather than swallowing it', async () => {
    requestScreenCaptureMock.mockResolvedValue('denied')
    expect(await systemHandlers['system.mac.request_screen_capture'](undefined, ctx('w1'))).toBe('denied')
  })

  it('shell.open_path delegates to the file entry point that validates the path', async () => {
    await systemHandlers['system.shell.open_path']('/tmp/foo', ctx('w1'))

    expect(openRequestPathMock).toHaveBeenCalledWith('/tmp/foo')
    expect(openPathMock).not.toHaveBeenCalled()
  })

  it('shell.open_website opens a URL that passes the scheme guard', async () => {
    isSafeMock.mockReturnValue(true)
    await systemHandlers['system.shell.open_website']('https://example.com', ctx('w1'))
    expect(navigation.openWebsite).toHaveBeenCalledWith('https://example.com')
  })

  it('shell.open_website delegates unsafe URL rejection to main without calling shell.openExternal', async () => {
    isSafeMock.mockReturnValue(false)
    await systemHandlers['system.shell.open_website']('javascript:alert(1)', ctx('w1'))
    expect(openExternalMock).not.toHaveBeenCalled()
    expect(navigation.openWebsite).toHaveBeenCalledWith('javascript:alert(1)')
  })
})

describe('external website input compatibility', () => {
  it.each([
    'https://example.test',
    { url: 'obsidian://open?vault=Notes', options: { activate: false, workingDirectory: '/tmp', logUsage: true } }
  ])('accepts and delegates %j with forced-external routing', async (input) => {
    const parsed = systemRequestSchemas['system.shell.open_external_website'].input.parse(input)
    await systemHandlers['system.shell.open_external_website'](parsed, ctx('w1'))
    const { url, options } = typeof input === 'string' ? { url: input, options: undefined } : input
    expect(navigation.openWebsite).toHaveBeenCalledExactlyOnceWith(url, true, options)
    expect(openExternalMock).not.toHaveBeenCalled()
  })
})
