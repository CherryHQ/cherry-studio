import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { collectProcessMetrics, sampleMemory } from '../memory'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('electron', () => ({
  app: { getAppMetrics: vi.fn() }
}))

describe('sampleMemory', () => {
  it('carries the process memory numbers through unchanged', () => {
    const usage = {
      rss: 431_000_000,
      heapTotal: 220_000_000,
      heapUsed: 176_000_000,
      external: 18_000_000,
      arrayBuffers: 6_000_000
    }
    const spy = vi.spyOn(process, 'memoryUsage').mockReturnValue(usage as NodeJS.MemoryUsage)

    expect(sampleMemory(() => 1234)).toEqual({ at: 1234, ...usage })

    spy.mockRestore()
  })
})

describe('collectProcessMetrics', () => {
  beforeEach(() => {
    vi.mocked(app.getAppMetrics).mockReset()
  })

  it('flattens Electron metrics into pid/type/cpu/memory rows', () => {
    vi.mocked(app.getAppMetrics).mockReturnValue([
      { pid: 4821, type: 'Browser', cpu: { percentCPUUsage: 3.25 }, memory: { workingSetSize: 421_888 } },
      {
        pid: 4830,
        type: 'Tab',
        name: 'main window',
        cpu: { percentCPUUsage: 11.8 },
        memory: { workingSetSize: 395_264 }
      }
    ] as unknown as Electron.ProcessMetric[])

    expect(collectProcessMetrics()).toEqual([
      { pid: 4821, type: 'Browser', name: undefined, cpuPercent: 3.25, memoryKb: 421_888 },
      { pid: 4830, type: 'Tab', name: 'main window', cpuPercent: 11.8, memoryKb: 395_264 }
    ])
  })

  it('returns an empty list instead of throwing when Electron cannot report metrics', () => {
    vi.mocked(app.getAppMetrics).mockImplementation(() => {
      throw new Error('app is not ready')
    })

    expect(collectProcessMetrics()).toEqual([])
  })
})
