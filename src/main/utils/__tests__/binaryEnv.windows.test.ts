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
      if (key === 'feature.binary.data.isolated.localappdata') return 'C:\\data\\binary-manager\\localappdata'
      if (key === 'feature.binary.data.isolated.appdata') return 'C:\\data\\binary-manager\\appdata'
      if (key === 'cherry.bin') return 'C:\\data\\bin'
      return `/mock/${key}`
    }
  }
}))

vi.mock('path')

import {
  getBinaryIsolatedHomeEnv,
  mergeBinaryExecutionEnv,
  mergePathSuffixes,
  pickSystemEnvironment
} from '../binaryEnv'

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

  it('appends and deduplicates a fallback after all caller PATH casings', () => {
    const merged = mergePathSuffixes({ Path: 'C:\\User\\Bin', PATH: 'C:\\Windows;C:\\DATA\\BIN' }, ['C:\\data\\bin'])

    const pathKeys = Object.keys(merged).filter((key) => key.toLowerCase() === 'path')
    expect(pathKeys).toHaveLength(1)
    expect(merged[pathKeys[0]].split(';')).toEqual(['C:\\User\\Bin', 'C:\\Windows', 'C:\\DATA\\BIN'])
  })

  it('relocates LOCALAPPDATA/APPDATA into the isolated data dir on Windows', () => {
    // aqua/Sigstore/TUF resolves its cache/config from %LOCALAPPDATA%/%APPDATA%;
    // the install subprocess strips the user's real values, so the isolated home
    // must supply them or verification fails with "Could not determine cache
    // directory" (#16719). Only set on Windows.
    const env = getBinaryIsolatedHomeEnv()
    expect(env['LOCALAPPDATA']).toBe('C:\\data\\binary-manager\\localappdata')
    expect(env['APPDATA']).toBe('C:\\data\\binary-manager\\appdata')
  })
})

describe('pickSystemEnvironment (Windows)', () => {
  const hostEnv = {
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
    windir: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT',
    TEMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
    USERPROFILE: 'C:\\Users\\tester'
  }

  it('carries the whole baseline a replacement child env cannot start without', () => {
    // A child spawned without SystemRoot cannot resolve the system DLLs and dies
    // with a Windows exception exit code before running any of its own code.
    expect(pickSystemEnvironment(hostEnv)).toEqual(hostEnv)
  })

  it('reads the baseline whatever case the host spells it in', () => {
    // Windows env keys are case-insensitive, so a captured host env can carry any
    // spelling; the child must receive the canonical one either way.
    expect(pickSystemEnvironment({ SYSTEMROOT: 'C:\\Windows', Pathext: '.EXE' })).toEqual({
      SystemRoot: 'C:\\Windows',
      PATHEXT: '.EXE'
    })
  })

  it('forwards nothing else from the host environment', () => {
    // The point of a replacement env is that unrelated host variables stay out of
    // the child. Widening the baseline must not become a way back in.
    const picked = pickSystemEnvironment({ ...hostEnv, DEEPSEEK_API_KEY: 'secret', Path: 'C:\\bin' })

    expect(picked).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(picked).not.toHaveProperty('Path')
  })

  it('skips variables the host does not define', () => {
    expect(pickSystemEnvironment({ SystemRoot: 'C:\\Windows', TEMP: undefined })).toEqual({
      SystemRoot: 'C:\\Windows'
    })
  })
})
