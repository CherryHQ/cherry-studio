import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBinarySearchDirs } from '../binaryEnv'

vi.mock('path')

describe('getBinarySearchDirs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))
  })

  it('returns the mise shims dir before the bundled cherry.bin dir', () => {
    // Shims must precede cherry.bin so a user-installed copy shadows the bundled
    // one — the same ordering getBinaryPath() and shellEnv.ts rely on. The global
    // '@application' mock resolves 'feature.binary.data' and 'cherry.bin'.
    expect(getBinarySearchDirs()).toEqual(['/mock/feature.binary.data/shims', '/mock/cherry.bin'])
  })
})
