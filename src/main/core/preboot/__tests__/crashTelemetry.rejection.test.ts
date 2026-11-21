import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppErrorContext } from '@shared/types/appError'

vi.mock('electron', () => ({
  app: { isReady: vi.fn(() => true), on: vi.fn() },
  crashReporter: { start: vi.fn() }
}))

vi.mock('@main/core/platform', () => ({
  isDev: true,
  isLinux: false,
  isMac: true,
  isWin: false
}))

import type * as TelemetryModule from '../crashTelemetry'
let telemetry: typeof TelemetryModule

describe('presentProductionUnhandledRejection', () => {
  const presented: AppErrorContext[] = []
  const present = vi.fn((context: AppErrorContext) => {
    presented.push(context)
    return true
  })

  beforeEach(async () => {
    vi.resetModules()
    telemetry = await import('../crashTelemetry')
    presented.length = 0
    present.mockClear()
    telemetry.setHandedOffErrorPresenter(present)
  })

  it('presents a later distinct fault after suppressing the same one inside the interval', () => {
    const { presentProductionUnhandledRejection: show, UNHANDLED_REJECTION_DEDUP_MS } = telemetry
    const first = new Error('database locked')

    expect(show(first, 1_000)).toBe(true)
    expect(show(first, 1_000 + UNHANDLED_REJECTION_DEDUP_MS - 1)).toBe(false)
    expect(show(new Error('disk full'), 1_000 + 1)).toBe(true)
    expect(show(first, 1_000 + UNHANDLED_REJECTION_DEDUP_MS)).toBe(true)

    expect(presented.map((context) => context.message)).toEqual(['database locked', 'disk full', 'database locked'])
    expect(presented[0]).toMatchObject({ source: 'main', operation: 'process.unhandledRejection', name: 'Error' })
  })

  it('does not remember a fault the presenter did not accept', () => {
    present.mockReturnValueOnce(false)

    expect(telemetry.presentProductionUnhandledRejection(new Error('database locked'), 5_000)).toBe(false)
    expect(telemetry.presentProductionUnhandledRejection(new Error('database locked'), 5_001)).toBe(true)
  })

  it('only logs while no presenter is registered', () => {
    telemetry.setHandedOffErrorPresenter(null)

    expect(telemetry.presentProductionUnhandledRejection(new Error('early'), 1)).toBe(false)
    expect(present).not.toHaveBeenCalled()
  })

  it('stays inside core: no services-tier import', () => {
    const source = readFileSync(join(__dirname, '../crashTelemetry.ts'), 'utf8')
    expect(source).not.toMatch(/@main\/services\//)
    expect(source).not.toMatch(/@application/)
  })
})
