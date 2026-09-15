import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  discardUpload: vi.fn(),
  exportBundle: vi.fn(),
  inspect: vi.fn(),
  retryUpload: vi.fn(),
  saveUploadBundle: vi.fn(),
  uploadBundle: vi.fn()
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
      hasWarnings: false,
      sourceLimitBytes: 1,
      sources: {
        chatRecords: { available: false, estimatedBytes: 0, messageCount: 0 },
        crashDumps: { fileCount: 0 },
        logs: { available: false, estimatedBytes: 0, fileCount: 0 },
        traces: { available: false, estimatedBytes: 0, fileCount: 0 }
      }
    }
    serviceMocks.inspect.mockResolvedValue(expected)

    await expect(
      diagnosticsHandlers['diagnostics.bundle.inspect']({ range: '3d' }, { senderId: 'main' })
    ).resolves.toEqual(expected)
    expect(serviceMocks.inspect).toHaveBeenCalledWith('3d')
  })

  it('passes the trusted caller window id to export', async () => {
    const input = { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' as const }
    serviceMocks.exportBundle.mockResolvedValue({ status: 'canceled' })

    await expect(diagnosticsHandlers['diagnostics.bundle.export'](input, { senderId: 'main-window' })).resolves.toEqual(
      { status: 'canceled' }
    )
    expect(serviceMocks.exportBundle).toHaveBeenCalledWith(input, 'main-window')
  })

  it('delegates diagnostic upload without adding a preload channel', async () => {
    const input = {
      description: 'The app stopped responding.',
      includeChatRecords: true,
      includeLogs: true,
      includeTraces: true,
      range: '24h' as const
    }
    serviceMocks.uploadBundle.mockResolvedValue({ status: 'uploaded' })

    await expect(diagnosticsHandlers['diagnostics.bundle.upload'](input, { senderId: 'main-window' })).resolves.toEqual(
      { status: 'uploaded' }
    )
    expect(serviceMocks.uploadBundle).toHaveBeenCalledWith(input)
  })

  it('delegates retry by opaque bundle id', async () => {
    const input = { bundleId: '123e4567-e89b-42d3-a456-426614174000' }
    serviceMocks.retryUpload.mockResolvedValue({ status: 'busy' })

    await expect(
      diagnosticsHandlers['diagnostics.bundle.retry_upload'](input, { senderId: 'main-window' })
    ).resolves.toEqual({ status: 'busy' })
    expect(serviceMocks.retryUpload).toHaveBeenCalledWith(input)
  })

  it('passes the trusted caller window id when saving a retained upload', async () => {
    const input = { bundleId: '123e4567-e89b-42d3-a456-426614174000' }
    serviceMocks.saveUploadBundle.mockResolvedValue({ status: 'canceled' })

    await expect(
      diagnosticsHandlers['diagnostics.bundle.save_upload'](input, { senderId: 'main-window' })
    ).resolves.toEqual({ status: 'canceled' })
    expect(serviceMocks.saveUploadBundle).toHaveBeenCalledWith(input, 'main-window')
  })

  it('delegates retained upload discard by opaque bundle id', async () => {
    const input = { bundleId: '123e4567-e89b-42d3-a456-426614174000' }
    serviceMocks.discardUpload.mockResolvedValue({ status: 'discarded' })

    await expect(
      diagnosticsHandlers['diagnostics.bundle.discard_upload'](input, { senderId: 'main-window' })
    ).resolves.toEqual({ status: 'discarded' })
    expect(serviceMocks.discardUpload).toHaveBeenCalledWith(input)
  })
})
