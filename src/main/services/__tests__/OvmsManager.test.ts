import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  exec: vi.fn(),
  stop: vi.fn(),
  unregister: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: mocks.appGet, getPath: vi.fn() }
}))

vi.mock('node:child_process', () => ({
  exec: mocks.exec,
  execFile: vi.fn()
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  const classDecorator = () => (target: unknown) => target

  return {
    BaseService: MockBaseService,
    Conditional: classDecorator,
    DependsOn: classDecorator,
    Injectable: classDecorator,
    onCpuVendor: vi.fn(),
    onPlatform: vi.fn(),
    Phase: { WhenReady: 'whenReady' },
    ServicePhase: classDecorator
  }
})

vi.mock('@main/services/process', () => ({
  ProcessState: {
    Starting: 'starting',
    Running: 'running',
    Stopping: 'stopping'
  }
}))

const { OvmsManager } = await import('../OvmsManager')

describe('OvmsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exec.mockImplementation((_command, callback) => callback(null, '', ''))
    mocks.stop.mockResolvedValue(undefined)
    mocks.unregister.mockResolvedValue(undefined)
  })

  it('cleans up externally started OVMS when the managed start is cancelled before spawn', async () => {
    const handle = { state: 'starting', stop: mocks.stop }
    mocks.appGet.mockReturnValue({
      get: vi.fn(() => handle),
      unregister: mocks.unregister
    })

    await expect(new OvmsManager().stopOvms()).resolves.toEqual({
      success: true,
      message: 'OVMS process stopped successfully'
    })
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.unregister).toHaveBeenCalledWith('ovms-server')
    expect(mocks.exec).toHaveBeenCalledWith(
      expect.stringContaining("CommandLine -like 'ovms.exe*'"),
      expect.any(Function)
    )
  })
})
