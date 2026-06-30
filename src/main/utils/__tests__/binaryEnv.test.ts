import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBinarySearchDirs, mergeBinaryExecutionEnv } from '../binaryEnv'

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

describe('mergeBinaryExecutionEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))
    vi.mocked(path.normalize).mockImplementation((p) => p)
    Object.defineProperty(path, 'delimiter', { value: ':', configurable: true })
  })

  it('does not duplicate the mise shims dir when the input PATH already carries it', () => {
    // shellEnv appends the tool dirs upstream, so the input PATH can already hold
    // the shims dir that mergeBinaryExecutionEnv prepends — it must appear once.
    const shims = '/mock/feature.binary.data/shims'
    const { PATH } = mergeBinaryExecutionEnv({ PATH: `${shims}:/usr/bin` })

    const segments = PATH.split(':')
    expect(segments.filter((s) => s === shims)).toHaveLength(1)
    expect(segments[0]).toBe(shims) // prepended copy wins, later duplicate dropped
  })
})
