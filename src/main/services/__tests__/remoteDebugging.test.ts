import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'
import { bootConfigSchema, DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'

import { configureRemoteDebugging } from '../remoteDebugging'

vi.mock('electron', () => ({
  app: { commandLine: { appendSwitch: vi.fn(), hasSwitch: vi.fn() } }
}))
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { get: vi.fn() } }))

describe('configureRemoteDebugging', () => {
  beforeEach(() => {
    vi.mocked(app.commandLine.appendSwitch).mockReset()
    vi.mocked(app.commandLine.hasSwitch).mockReset().mockReturnValue(false)
    vi.mocked(bootConfigService.get)
      .mockReset()
      .mockImplementation((key) => DefaultBootConfig[key])
  })

  const enable = (port = 9222) => {
    vi.mocked(bootConfigService.get).mockImplementation((key) => {
      if (key === 'app.remote_debugging.enabled') return true
      if (key === 'app.remote_debugging.port') return port
      return DefaultBootConfig[key]
    })
  }

  it('does not enable a listener by default', () => {
    configureRemoteDebugging()
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled()
  })

  it.each([9222, 9342])('opens saved port %s only on loopback', (port) => {
    enable(port)
    configureRemoteDebugging()
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('remote-debugging-port', String(port))
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
  })

  it('preserves an explicit startup port and constrains its address to loopback', () => {
    enable()
    vi.mocked(app.commandLine.hasSwitch).mockImplementation((name) => name === 'remote-debugging-port')
    configureRemoteDebugging()
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith('remote-debugging-port', expect.anything())
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
  })

  it.each([0, 65535, 65536, 1.5, '9222', NaN])('rejects an invalid configured port: %s', (port) => {
    expect(bootConfigSchema.safeParse({ ...DefaultBootConfig, 'app.remote_debugging.port': port }).success).toBe(false)
  })

  it.each([1, 65534])('accepts a supported port boundary: %s', (port) => {
    expect(bootConfigSchema.safeParse({ ...DefaultBootConfig, 'app.remote_debugging.port': port }).success).toBe(true)
  })
})
