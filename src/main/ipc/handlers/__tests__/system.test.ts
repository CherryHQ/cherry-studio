import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  getDeviceTypeMock,
  getCountryMock,
  getFontsMock,
  isTrustedMock,
  openPathMock,
  openExternalMock,
  isSafeMock,
  platform
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  getDeviceTypeMock: vi.fn(),
  getCountryMock: vi.fn(),
  getFontsMock: vi.fn(),
  isTrustedMock: vi.fn(),
  openPathMock: vi.fn(),
  openExternalMock: vi.fn(),
  isSafeMock: vi.fn(),
  platform: { isMac: true }
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/utils/system', () => ({ getDeviceType: getDeviceTypeMock }))
vi.mock('@main/services/RegionService', () => ({ regionService: { getCountry: getCountryMock } }))
vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: isSafeMock }))
vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))
vi.mock('electron', () => ({
  systemPreferences: { isTrustedAccessibilityClient: isTrustedMock },
  shell: { openPath: openPathMock, openExternal: openExternalMock }
}))
vi.mock('font-list', () => ({ default: { getFonts: getFontsMock } }))

import { systemHandlers } from '../system'

const toggleDevTools = vi.fn()
const windowManager = { getWindow: vi.fn(() => ({ webContents: { toggleDevTools } })) }

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  platform.isMac = true
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('systemHandlers', () => {
  it('get_device_type delegates to the platform util', async () => {
    getDeviceTypeMock.mockReturnValue('mac')
    expect(await systemHandlers['system.get_device_type'](undefined, ctx('w1'))).toBe('mac')
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

  it('toggle_dev_tools toggles the caller window resolved from senderId', async () => {
    await systemHandlers['system.toggle_dev_tools'](undefined, ctx('w1'))
    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(toggleDevTools).toHaveBeenCalledOnce()
  })

  it('toggle_dev_tools is a no-op when the caller is not a tracked window', async () => {
    await systemHandlers['system.toggle_dev_tools'](undefined, ctx(null))
    expect(windowManager.getWindow).not.toHaveBeenCalled()
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

  it('shell.open_path delegates straight to shell.openPath', async () => {
    await systemHandlers['system.shell.open_path']('/tmp/foo', ctx('w1'))
    expect(openPathMock).toHaveBeenCalledWith('/tmp/foo')
  })

  it('shell.open_website opens a URL that passes the scheme guard', async () => {
    isSafeMock.mockReturnValue(true)
    await systemHandlers['system.shell.open_website']('https://example.com', ctx('w1'))
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com')
  })

  it('shell.open_website drops an unsafe URL without calling shell.openExternal', async () => {
    isSafeMock.mockReturnValue(false)
    await systemHandlers['system.shell.open_website']('javascript:alert(1)', ctx('w1'))
    expect(openExternalMock).not.toHaveBeenCalled()
  })
})
