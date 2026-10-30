import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deliver, getExisting, isReady } = vi.hoisted(() => ({
  deliver: vi.fn(),
  getExisting: vi.fn(),
  isReady: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { isReady, on: vi.fn() },
  crashReporter: { start: vi.fn() }
}))

vi.mock('@application', () => ({
  application: { getExisting: (...args: unknown[]) => getExisting(...args) }
}))

vi.mock('@main/services/mainWindowNavigation', () => ({
  deliverToReadyMain: (...args: unknown[]) => deliver(...args)
}))

vi.mock('@main/core/platform', () => ({
  isDev: true,
  isLinux: false,
  isMac: true,
  isWin: false
}))

import { UNHANDLED_REJECTION_DEDUP_MS } from '../crashTelemetry'
import type * as TelemetryModule from '../crashTelemetry'
let presentProductionUnhandledRejection: typeof TelemetryModule.presentProductionUnhandledRejection

describe('presentProductionUnhandledRejection', () => {
  beforeEach(async () => {
    vi.resetModules()
    ;({ presentProductionUnhandledRejection } = await import('../crashTelemetry'))

    deliver.mockReset().mockReturnValue(true)
    getExisting.mockReset().mockReturnValue({})
    isReady.mockReset().mockReturnValue(true)
  })

  it('presents a later distinct fault after suppressing the same one inside the interval', async () => {
    const first = new Error('database locked')
    const second = new Error('disk full')

    await expect(presentProductionUnhandledRejection(first, 1_000)).resolves.toBe(true)
    await expect(presentProductionUnhandledRejection(first, 1_000 + UNHANDLED_REJECTION_DEDUP_MS - 1)).resolves.toBe(
      false
    )
    await expect(presentProductionUnhandledRejection(second, 1_000 + 1)).resolves.toBe(true)
    await expect(presentProductionUnhandledRejection(first, 1_000 + UNHANDLED_REJECTION_DEDUP_MS)).resolves.toBe(true)

    expect(deliver).toHaveBeenCalledTimes(3)
    expect(deliver.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        source: 'main',
        operation: 'process.unhandledRejection',
        message: 'database locked',
        name: 'Error'
      })
    )
  })

  it('presents distinct faults that overlap during the handoff import', async () => {
    const first = presentProductionUnhandledRejection(new Error('database locked'), 2_000)
    const second = presentProductionUnhandledRejection(new Error('disk full'), 2_000)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('does not remember a fault the main window did not accept', async () => {
    deliver.mockReturnValueOnce(false).mockReturnValueOnce(true)

    await expect(presentProductionUnhandledRejection(new Error('database locked'), 5_000)).resolves.toBe(false)
    await expect(presentProductionUnhandledRejection(new Error('database locked'), 5_001)).resolves.toBe(true)
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('does nothing before Electron and its window services exist', async () => {
    isReady.mockReturnValue(false)
    await expect(presentProductionUnhandledRejection(new Error('early'), 1)).resolves.toBe(false)

    isReady.mockReturnValue(true)
    getExisting.mockReturnValue(undefined)
    await expect(presentProductionUnhandledRejection(new Error('early'), 2)).resolves.toBe(false)
    expect(deliver).not.toHaveBeenCalled()
  })
})
