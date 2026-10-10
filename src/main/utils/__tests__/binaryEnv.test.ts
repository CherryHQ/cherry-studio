import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  getBinaryIsolatedHomeEnv,
  getBinarySearchDirs,
  getBinaryShimsDir,
  mergeBinaryExecutionEnv,
  mergePathPrefixes,
  mergePathSuffixes
} from '../binaryEnv'

// Real `node:path` (posix on CI) — the dedup's canonicalization runs against
// the actual normalize()/delimiter, not an identity stub. Windows case-folding
// is covered separately in binaryEnv.windows.test.ts.

describe('getBinarySearchDirs', () => {
  it('exposes the mise shims directory without relying on search order', () => {
    expect(getBinaryShimsDir()).toBe('/mock/feature.binary.data/shims')
  })

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

describe('mergePathPrefixes', () => {
  it('changes only PATH and preserves a caller-owned mise contract', () => {
    const env = mergePathPrefixes(
      {
        PATH: '/user/mise/shims:/usr/bin',
        MISE_DATA_DIR: '/user/mise',
        CUSTOM: 'preserved'
      },
      ['/mock/cherry.bin']
    )

    expect(env.PATH.split(':')).toEqual(['/mock/cherry.bin', '/user/mise/shims', '/usr/bin'])
    expect(env).toMatchObject({ MISE_DATA_DIR: '/user/mise', CUSTOM: 'preserved' })
    expect(env.MISE_CONFIG_DIR).toBeUndefined()
  })

  it('can append a fallback without replacing caller PATH precedence', () => {
    const env = mergePathSuffixes({ PATH: '/user/mise/shims:/usr/bin' }, ['/mock/cherry.bin'])

    expect(env.PATH.split(':')).toEqual(['/user/mise/shims', '/usr/bin', '/mock/cherry.bin'])
  })
})

describe('getBinaryIsolatedHomeEnv', () => {
  it('does not set Windows cache dirs off Windows', () => {
    // LOCALAPPDATA/APPDATA are a Windows-only aqua/TUF fix — on posix they must
    // stay absent so nothing spurious leaks into the isolated env. Windows
    // presence is covered in binaryEnv.windows.test.ts.
    const env = getBinaryIsolatedHomeEnv()
    expect(env['HOME']).toBe('/mock/feature.binary.data/home')
    expect(env['LOCALAPPDATA']).toBeUndefined()
    expect(env['APPDATA']).toBeUndefined()
  })
})

describe('mergePathEntries on POSIX', () => {
  it('ignores a lowercase `path` variable instead of merging it into PATH', async () => {
    // POSIX env keys are case-sensitive: a stray lowercase `path` (e.g. an app
    // setting) must not contribute segments to the child PATH, and must survive
    // the merge untouched. Host-independent via a platform stub.
    vi.resetModules()
    vi.doMock('@main/core/platform', () => ({
      isWin: false,
      isMac: false,
      isLinux: true,
      isDev: false,
      isPortable: false
    }))
    const posixBinaryEnv = await import('../binaryEnv')

    const merged = posixBinaryEnv.mergePathSuffixes(
      { PATH: ['/usr/bin'].join(path.delimiter), path: ['/stray/evil'].join(path.delimiter) },
      ['/tail']
    )

    expect(merged.PATH?.split(path.delimiter)).toEqual(['/usr/bin', '/tail'])
    expect(merged.path).toBe('/stray/evil')
  })
})
