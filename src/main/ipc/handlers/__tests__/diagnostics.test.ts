import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  inspect: vi.fn(),
  revealLastBundle: vi.fn()
}))

vi.mock('@main/services/diagnostics', () => ({
  diagnosticBundleService: serviceMocks
}))

import { diagnosticsHandlers } from '../diagnostics'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('diagnosticsHandlers', () => {
  it('delegates inspection to the diagnostic bundle service', async () => {
    const expected = {
      range: { from: 'from', to: 'to' },
      sourceLimitBytes: 1,
      sources: {
        crashDumps: { available: false, estimatedBytes: 0, fileCount: 0 },
        logs: { available: false, estimatedBytes: 0, fileCount: 0 },
        traces: { available: false, estimatedBytes: 0, fileCount: 0 }
      },
      warnings: []
    }
    serviceMocks.inspect.mockResolvedValue(expected)

    await expect(
      diagnosticsHandlers['diagnostics.bundle.inspect']({ range: '3d' }, { senderId: 'main' })
    ).resolves.toEqual(expected)
    expect(serviceMocks.inspect).toHaveBeenCalledWith('3d')
  })

  it('passes the trusted caller window id to export', async () => {
    const input = { includeLogs: true, includeTraces: false, range: '24h' as const }
    serviceMocks.exportBundle.mockResolvedValue({ status: 'canceled' })

    await expect(diagnosticsHandlers['diagnostics.bundle.export'](input, { senderId: 'main-window' })).resolves.toEqual(
      { status: 'canceled' }
    )
    expect(serviceMocks.exportBundle).toHaveBeenCalledWith(input, 'main-window')
  })

  it('reveals only through the service-owned last path', async () => {
    serviceMocks.revealLastBundle.mockResolvedValue(true)

    await expect(diagnosticsHandlers['diagnostics.bundle.reveal'](undefined, { senderId: 'main' })).resolves.toBe(true)
    expect(serviceMocks.revealLastBundle).toHaveBeenCalledOnce()
  })
})
