import type * as FsPromises from 'node:fs/promises'
import { lstat } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { workspaceStat } from '../agentWorkspaceStorage'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

afterEach(() => vi.clearAllMocks())

describe('workspaceStat filesystem failures', () => {
  it.each([
    null,
    'filesystem failure',
    { code: 17 },
    Object.defineProperty({}, 'code', {
      get() {
        throw new Error('unreadable code')
      }
    })
  ])('preserves an unclassified rejection instead of reporting a missing path (%#)', async (failure) => {
    vi.mocked(lstat).mockRejectedValueOnce(failure)
    await expect(workspaceStat('/unused-workspace')).rejects.toBe(failure)
  })
})
