import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SourceCollectorModule from '../sourceCollector'
import type { SourceCollection } from '../types'

const sourceMocks = vi.hoisted(() => ({
  collectCrashDumpInventory: vi.fn(),
  collectDiagnosticSources: vi.fn()
}))

vi.mock('../sourceCollector', async (importOriginal) => {
  const actual = await importOriginal<typeof SourceCollectorModule>()
  return {
    ...actual,
    collectCrashDumpInventory: sourceMocks.collectCrashDumpInventory,
    collectDiagnosticSources: sourceMocks.collectDiagnosticSources
  }
})

import { DiagnosticBundleService } from '../DiagnosticBundleService'

function emptyCollection(): SourceCollection {
  return { logs: [], traces: [], warnings: new Set() }
}

describe('DiagnosticBundleService inspection scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sourceMocks.collectCrashDumpInventory.mockResolvedValue({ files: [], totalBytes: 0 })
  })

  it('does not scan diagnostic sources concurrently', async () => {
    let finishFirstScan: () => void = () => undefined
    sourceMocks.collectDiagnosticSources
      .mockImplementationOnce(
        () =>
          new Promise<SourceCollection>((resolve) => {
            finishFirstScan = () => resolve(emptyCollection())
          })
      )
      .mockResolvedValueOnce(emptyCollection())
    const service = new DiagnosticBundleService()

    const firstInspection = service.inspect('24h')
    await vi.waitFor(() => expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(1))

    const secondInspection = service.inspect('3d')
    await Promise.resolve()
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(1)

    finishFirstScan()
    await firstInspection
    await secondInspection
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(2)
  })
})
