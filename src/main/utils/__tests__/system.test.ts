import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getGPUInfo } = vi.hoisted(() => ({ getGPUInfo: vi.fn() }))

vi.mock('electron', () => ({
  app: { getGPUInfo }
}))

// hasIntelGpu memoizes at module scope, so reload the module per test for a fresh probe.
const loadHasIntelGpu = async () => (await import('../system')).hasIntelGpu

describe('hasIntelGpu', () => {
  beforeEach(() => {
    vi.resetModules()
    getGPUInfo.mockReset()
  })

  it('returns true when a device has the Intel vendor id (0x8086)', async () => {
    getGPUInfo.mockResolvedValue({ gpuDevice: [{ vendorId: 0x10de }, { vendorId: 0x8086 }] })
    const hasIntelGpu = await loadHasIntelGpu()
    expect(await hasIntelGpu()).toBe(true)
  })

  it('returns false when no device is Intel', async () => {
    getGPUInfo.mockResolvedValue({ gpuDevice: [{ vendorId: 0x10de }] })
    const hasIntelGpu = await loadHasIntelGpu()
    expect(await hasIntelGpu()).toBe(false)
  })

  it('returns false when the device list is empty (e.g. software rendering)', async () => {
    getGPUInfo.mockResolvedValue({ gpuDevice: [] })
    const hasIntelGpu = await loadHasIntelGpu()
    expect(await hasIntelGpu()).toBe(false)
  })

  it('returns false when getGPUInfo rejects', async () => {
    getGPUInfo.mockRejectedValue(new Error('gpu process unavailable'))
    const hasIntelGpu = await loadHasIntelGpu()
    expect(await hasIntelGpu()).toBe(false)
  })

  it('memoizes the probe so getGPUInfo runs at most once', async () => {
    getGPUInfo.mockResolvedValue({ gpuDevice: [{ vendorId: 0x8086 }] })
    const hasIntelGpu = await loadHasIntelGpu()
    await Promise.all([hasIntelGpu(), hasIntelGpu(), hasIntelGpu()])
    expect(getGPUInfo).toHaveBeenCalledTimes(1)
  })
})
