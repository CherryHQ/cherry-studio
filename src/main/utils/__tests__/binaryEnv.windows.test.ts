import type * as NodePath from 'path'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pin the Windows code path so we exercise mergeBinaryExecutionEnv's
// case-insensitive PATH dedup (the `.toLowerCase()` branch), which the
// host-platform run in binaryEnv.test.ts (isWin=false) cannot reach.
vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      if (key === 'feature.binary.data') return 'C:\\data\\binary-manager'
      if (key === 'cherry.bin') return 'C:\\data\\bin'
      return `/mock/${key}`
    }
  }
}))

vi.mock('path')

import { mergeBinaryExecutionEnv } from '../binaryEnv'

describe('mergeBinaryExecutionEnv (Windows)', () => {
  beforeEach(async () => {
    // Route join/normalize to the REAL win32 implementations so the dedup's
    // canonicalization is exercised against actual Windows path semantics
    // (backslash/forward-slash folding, `..` collapse) on a posix CI host —
    // an identity stub would let separator variants slip through untested.
    // vi.importActual bypasses the module-level `vi.mock('path')` (which would
    // otherwise auto-mock win32 too, returning undefined).
    vi.clearAllMocks()
    const { win32 } = await vi.importActual<typeof NodePath>('path')
    vi.mocked(path.join).mockImplementation((...args) => win32.join(...args))
    vi.mocked(path.normalize).mockImplementation((p) => win32.normalize(p))
  })

  it('dedups PATH segments case-insensitively and keeps the prepended shims dir first', () => {
    // Windows paths are case-insensitive, so a differently-cased duplicate of the
    // shims dir (and of any system dir) must collapse to one — first occurrence wins.
    const shims = 'C:\\data\\binary-manager\\shims'
    const { Path } = mergeBinaryExecutionEnv({
      Path: 'c:\\data\\binary-manager\\SHIMS;C:\\Windows;c:\\windows'
    })

    const segments = Path.split(';')
    expect(segments[0]).toBe(shims) // prepended copy wins, later cased duplicate dropped
    expect(segments.filter((s) => s.toLowerCase() === shims.toLowerCase())).toHaveLength(1)
    expect(segments.filter((s) => s.toLowerCase() === 'c:\\windows')).toHaveLength(1)
  })

  it('collapses duplicate PATH casings into one key, merging segments from all of them', () => {
    // Windows env keys are case-insensitive: an input carrying both `Path` and
    // `PATH` must collapse to a single key so a stale casing cannot shadow the
    // merged value at spawn time — and no segment from either casing is lost.
    const shims = 'C:\\data\\binary-manager\\shims'
    const merged = mergeBinaryExecutionEnv({ Path: 'C:\\Windows', PATH: 'C:\\Other' })

    const pathKeys = Object.keys(merged).filter((k) => k.toLowerCase() === 'path')
    expect(pathKeys).toHaveLength(1) // collapsed to a single canonical key

    const segments = merged[pathKeys[0]].split(';')
    expect(segments[0]).toBe(shims) // shims still first
    expect(segments).toContain('C:\\Windows') // kept from the `Path` casing
    expect(segments).toContain('C:\\Other') // kept from the `PATH` casing
  })

  it('folds forward-slash and backslash spellings of the same dir via real normalize', () => {
    // win32.normalize turns `C:/Windows` into `C:\Windows`, so the two spellings
    // canonicalize to one entry — a case the old identity-normalize stub missed.
    // Dedup keeps the first original spelling, so `C:/Windows` survives.
    const shims = 'C:\\data\\binary-manager\\shims'
    const { Path } = mergeBinaryExecutionEnv({
      Path: 'C:/Windows;C:\\Windows'
    })

    expect(Path.split(';')).toEqual([shims, 'C:/Windows'])
  })
})
