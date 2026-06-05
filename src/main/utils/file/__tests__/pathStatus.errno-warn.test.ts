/**
 * Errno-injection test for the one `getPathStatus` branch that can't be driven
 * with a real filesystem: the `inaccessible` catch-all (any errno other than
 * `ENOENT` / `ENOTDIR`). `EACCES` needs root-flipped chmod chains that race
 * cleanup and are bypassed when CI runs as root; `EIO` can't be provoked at
 * all. So `../fs`'s `stat` is partially mocked here (every other export falls
 * through) to reject with a synthetic errno — isolated in its own file so the
 * real-fs tests in `pathStatus.test.ts` keep exercising the shipped code.
 */

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStat = vi.hoisted(() => vi.fn())

vi.mock('../fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fs')>()
  return { ...actual, stat: mockStat }
})

const { getPathStatus } = await import('../pathStatus')

describe('getPathStatus — inaccessible fallback', () => {
  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  it('maps an unexpected errno (EIO) to inaccessible and warn-logs', async () => {
    mockStat.mockRejectedValueOnce(Object.assign(new Error('disk failure'), { code: 'EIO' }))

    await expect(getPathStatus('/some/absolute/path')).resolves.toEqual({
      ok: false,
      reason: 'inaccessible',
      detail: 'disk failure'
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
  })
})
