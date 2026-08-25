import { diagnosticsRequestSchemas } from '@shared/ipc/schemas/diagnostics'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  inspect: vi.fn(),
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

  it('requires the explicit chat-record selection in strict bundle inputs', () => {
    const schema = diagnosticsRequestSchemas['diagnostics.bundle.export'].input

    expect(
      schema.safeParse({ includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' }).success
    ).toBe(true)
    expect(schema.safeParse({ includeLogs: true, includeTraces: false, range: '24h' }).success).toBe(false)
    expect(
      schema.safeParse({
        includeChatRecords: false,
        includeLogs: true,
        includeTraces: false,
        range: '24h',
        unexpected: true
      }).success
    ).toBe(false)
  })

  it('passes the trusted caller window id to export', async () => {
    const input = { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' as const }
    serviceMocks.exportBundle.mockResolvedValue({ status: 'canceled' })

    await expect(diagnosticsHandlers['diagnostics.bundle.export'](input, { senderId: 'main-window' })).resolves.toEqual(
      { status: 'canceled' }
    )
    expect(serviceMocks.exportBundle).toHaveBeenCalledWith(input, 'main-window')
  })

  it('delegates anonymous upload without adding a preload channel', async () => {
    const input = { includeChatRecords: true, includeLogs: true, includeTraces: true, range: '24h' as const }
    serviceMocks.uploadBundle.mockResolvedValue({ status: 'uploaded' })

    await expect(diagnosticsHandlers['diagnostics.bundle.upload'](input, { senderId: 'main-window' })).resolves.toEqual(
      { status: 'uploaded' }
    )
    expect(serviceMocks.uploadBundle).toHaveBeenCalledWith(input)
  })
})
