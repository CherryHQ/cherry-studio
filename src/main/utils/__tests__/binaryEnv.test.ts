import { describe, expect, it } from 'vitest'

import { getBinarySearchDirs, mergeBinaryExecutionEnv } from '../binaryEnv'

// Real `node:path` (posix on CI) — the dedup's canonicalization runs against
// the actual normalize()/delimiter, not an identity stub. Windows case-folding
// is covered separately in binaryEnv.windows.test.ts.

describe('getBinarySearchDirs', () => {
  it('returns the mise shims dir before the bundled cherry.bin dir', () => {
    // Shims must precede cherry.bin so a user-installed copy shadows the bundled
    // one — the same ordering getBinaryPath() and shellEnv.ts rely on. The global
    // '@application' mock resolves 'feature.binary.data' and 'cherry.bin'.
    expect(getBinarySearchDirs()).toEqual(['/mock/feature.binary.data/shims', '/mock/cherry.bin'])
  })
})

describe('mergeBinaryExecutionEnv', () => {
  const shims = '/mock/feature.binary.data/shims'

  it('does not duplicate the mise shims dir when the input PATH already carries it', () => {
    // shellEnv appends the tool dirs upstream, so the input PATH can already hold
    // the shims dir that mergeBinaryExecutionEnv prepends — it must appear once.
    const { PATH } = mergeBinaryExecutionEnv({ PATH: `${shims}:/usr/bin` })

    const segments = PATH.split(':')
    expect(segments.filter((s) => s === shims)).toHaveLength(1)
    expect(segments[0]).toBe(shims) // prepended copy wins, later duplicate dropped
  })

  it('inserts extraPathPrefixes after the shims dir but before the existing PATH', () => {
    // extraPathPrefixes exists so buildIsolatedEnv can put mise's own dir on PATH
    // for a re-exec'd child mise — pinned here so the shims → prefixes → rest
    // ordering can't silently regress.
    const { PATH } = mergeBinaryExecutionEnv({ PATH: '/usr/bin' }, ['/opt/mise/bin'])

    expect(PATH.split(':')).toEqual([shims, '/opt/mise/bin', '/usr/bin'])
  })
})
