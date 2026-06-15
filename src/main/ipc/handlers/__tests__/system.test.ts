import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fontListGetFontsMock,
  getCpuNameMock,
  getDeviceTypeMock,
  getHostnameMock,
  loggerErrorMock,
  platformState,
  systemTrustMock
} = vi.hoisted(() => ({
  fontListGetFontsMock: vi.fn(),
  getCpuNameMock: vi.fn(),
  getDeviceTypeMock: vi.fn(),
  getHostnameMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  platformState: { isMac: false },
  systemTrustMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: loggerErrorMock })
  }
}))
vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platformState.isMac
  }
}))
vi.mock('@main/utils/system', () => ({
  getCpuName: getCpuNameMock,
  getDeviceType: getDeviceTypeMock,
  getHostname: getHostnameMock
}))
vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: systemTrustMock
  }
}))
vi.mock('font-list', () => ({
  default: {
    getFonts: fontListGetFontsMock
  }
}))

import { systemHandlers } from '../system'

const ctx = (senderId: string | null) => ({ senderId })

beforeEach(() => {
  vi.clearAllMocks()
  platformState.isMac = false
  getDeviceTypeMock.mockReturnValue('mac')
  getHostnameMock.mockReturnValue('host.local')
  getCpuNameMock.mockReturnValue('Apple M4')
  fontListGetFontsMock.mockResolvedValue(['"Inter"', 'SF Pro'])
  systemTrustMock.mockReturnValue(true)
})

describe('systemHandlers', () => {
  it('returns system utility values', async () => {
    expect(await systemHandlers['system.get_device_type'](undefined, ctx('w1'))).toBe('mac')
    expect(await systemHandlers['system.get_hostname'](undefined, ctx('w1'))).toBe('host.local')
    expect(await systemHandlers['system.get_cpu_name'](undefined, ctx('w1'))).toBe('Apple M4')
  })

  it('normalizes quoted system font names', async () => {
    expect(await systemHandlers['system.get_fonts'](undefined, ctx('w1'))).toEqual(['Inter', 'SF Pro'])
  })

  it('returns an empty font list when font enumeration fails', async () => {
    const error = new Error('font failure')
    fontListGetFontsMock.mockRejectedValue(error)

    expect(await systemHandlers['system.get_fonts'](undefined, ctx('w1'))).toEqual([])
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to get system fonts:', error)
  })

  it('process trust routes return false off macOS', async () => {
    expect(await systemHandlers['system.is_process_trusted'](undefined, ctx('w1'))).toBe(false)
    expect(await systemHandlers['system.request_process_trust'](undefined, ctx('w1'))).toBe(false)
    expect(systemTrustMock).not.toHaveBeenCalled()
  })

  it('process trust routes delegate to macOS accessibility APIs on macOS', async () => {
    platformState.isMac = true

    expect(await systemHandlers['system.is_process_trusted'](undefined, ctx('w1'))).toBe(true)
    expect(systemTrustMock).toHaveBeenCalledWith(false)

    expect(await systemHandlers['system.request_process_trust'](undefined, ctx('w1'))).toBe(true)
    expect(systemTrustMock).toHaveBeenCalledWith(true)
  })
})
