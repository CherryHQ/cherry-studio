import { expect, it, vi } from 'vitest'

const collect = vi.hoisted(() => vi.fn())
vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { get: () => true } }))
vi.mock('@main/services/diagnostics/scan', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  collectErrorLogRecords: collect
}))

import { hardwareAcceleration } from '../checks/config'
import { recentLogFindings } from '../checks/logs'
import type { DoctorContext } from '../types'

it('shares one complete log read between hardware and recent-findings checks', async () => {
  collect
    .mockResolvedValueOnce({ records: [], unparsedLineCount: 0, skippedFileCount: 0, truncated: false })
    .mockRejectedValue(new Error('second read must not run'))
  const memo = new Map<string, Promise<unknown>>()
  const signal = new AbortController().signal
  const ctx: DoctorContext = {
    signal,
    share: <T>(key: string, factory: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      if (!memo.has(key)) memo.set(key, factory(signal))
      return memo.get(key) as Promise<T>
    }
  }
  const [hardware, logs] = await Promise.all([hardwareAcceleration.run(ctx), recentLogFindings.run(ctx)])
  expect(hardware).toMatchObject({ status: 'warn', actions: [{ kind: 'navigate', target: '/settings/general' }] })
  expect(logs).toMatchObject({ status: 'pass' })
  expect(collect).toHaveBeenCalledTimes(1)
})
