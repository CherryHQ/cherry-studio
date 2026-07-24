import { execFileSync, spawn } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Force Windows code path regardless of the host platform.
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
      if (key === 'cherry.bin') return 'C:\\Users\\test\\.cherrystudio\\bin'
      if (key === 'feature.binary.data') {
        return 'C:\\Users\\test\\AppData\\Roaming\\CherryStudio\\Toolchain\\mise'
      }
      if (key === 'sys.home') return 'C:\\Users\\test'
      return `/mock/${key}`
    }
  }
}))

vi.mock('child_process')

// Control the bundled-git resolution; default null so most tests see no bundled
// git appended (matching a build/host without the Windows MinGit bundle).
vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null),
  getBundledGitDir: vi.fn(() => null)
}))

// Import AFTER mocks are registered so the module binds to mocked values.
import { getBundledGitDir } from '../bundledGit'
import { getRawShellEnv, getShellEnv, refreshShellEnv } from '../shellEnv'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate `reg query` output for a REG_EXPAND_SZ value. */
const regOutput = (keyPath: string, value: string) => `\r\n${keyPath}\r\n    Path    REG_EXPAND_SZ    ${value}\r\n\r\n`

/** Simulate `reg query` output for a plain REG_SZ value. */
const regSzOutput = (keyPath: string, value: string) => `\r\n${keyPath}\r\n    Path    REG_SZ    ${value}\r\n\r\n`

const HKLM_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const HKCU_KEY = 'HKCU\\Environment'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shellEnv – Windows registry PATH', () => {
  const savedEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()

    // Minimal process.env used by getWindowsEnvironment()
    process.env = {
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\TestUser',
      Path: 'C:\\StaleOldPath'
    }
  })

  afterEach(() => {
    process.env = savedEnv
  })

  // -- registry reads -------------------------------------------------------

  it('should replace stale PATH with fresh system registry value', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) {
        return regOutput(keyPath, 'C:\\Windows\\system32;C:\\Windows;C:\\NodeJS')
      }
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\NodeJS')
    expect(env.Path).not.toContain('C:\\StaleOldPath')
  })

  it('should combine system and user PATH with semicolon', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\System')
      if (keyPath === HKCU_KEY) return regOutput(keyPath, 'C:\\User')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    // System PATH comes first, user PATH second.
    const pathValue = [env.Path, env.PATH].filter(Boolean).join(';')
    expect(pathValue).toContain('C:\\System')
    expect(pathValue).toContain('C:\\User')
    expect(pathValue).toContain('C:\\System;C:\\User')
  })

  it('should use only user PATH when system PATH is unavailable', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKCU_KEY) return regOutput(keyPath, 'C:\\UserOnly')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\UserOnly')
  })

  it('should fall back to process.env PATH when both registry reads fail', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('registry unavailable')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\StaleOldPath')
  })

  // -- %VAR% expansion ------------------------------------------------------

  it('should expand %SystemRoot% in registry PATH', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, '%SystemRoot%\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\Windows\\system32')
    expect(env.Path).not.toContain('%SystemRoot%')
  })

  it('should preserve unknown %VAR% references unexpanded', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, '%UNKNOWN_VAR%\\bin')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('%UNKNOWN_VAR%')
  })

  it('should expand variables case-insensitively', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, '%systemroot%\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\Windows\\system32')
  })

  // -- REG_SZ (no expand) ---------------------------------------------------

  it('should handle REG_SZ values without %VAR% expansion needed', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regSzOutput(keyPath, 'C:\\PlainPath')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\PlainPath')
  })

  // -- Cherry Studio tool directories appended ------------------------------

  it('should preserve the unmodified user environment for system tools', async () => {
    process.env.MISE_DATA_DIR = 'C:\\Users\\TestUser\\mise-data'
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows;C:\\UserNode')
      throw new Error('not found')
    })

    await refreshShellEnv()
    const env = await getRawShellEnv()

    expect(env.MISE_DATA_DIR).toBe('C:\\Users\\TestUser\\mise-data')
    expect(env.Path).toBe('C:\\Windows;C:\\UserNode')
    expect(env.Path).not.toContain('.cherrystudio')
  })

  it('should append Cherry Studio tool directories to PATH', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('.cherrystudio')
    expect(env.Path).toContain('Toolchain\\mise')
    expect(env.Path).toContain('shims')
    expect(env.Path).toContain('bin')
  })

  it('lists the mise shims dir only once despite appending and prepending it', async () => {
    // appendCherryToolDirsToPath() adds the shims dir, then mergeBinaryExecutionEnv()
    // prepends it again — the merge step must dedup so it does not appear twice.
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const shimsCount = env.Path.split(';').filter((seg) => seg.endsWith('shims')).length
    expect(shimsCount).toBe(1)
  })

  it('appends the bundled MinGit dir to the PATH tail as a last-resort git', async () => {
    const bundledGitDir = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd'
    vi.mocked(getBundledGitDir).mockReturnValue(bundledGitDir)
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Git\\cmd;C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const segments = env.Path.split(';')
    // Present, and dead last so system git (C:\Git\cmd) and the managed tool dirs win ahead of it.
    expect(segments[segments.length - 1]).toBe(bundledGitDir)
    expect(segments.indexOf('C:\\Git\\cmd')).toBeLessThan(segments.length - 1)
  })

  // -- does not spawn cmd.exe -----------------------------------------------

  it('should not spawn cmd.exe or any shell process', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    await refreshShellEnv()

    expect(spawn).not.toHaveBeenCalled()
  })

  // -- concurrent dedup -----------------------------------------------------

  it('should collapse overlapping fetches onto a single env resolution', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    // getWindowsEnvironment() reads HKLM + HKCU, i.e. two execFileSync calls
    // per resolution. Overlapping callers must share one resolution → 2 calls.
    await Promise.all([refreshShellEnv(), refreshShellEnv(), getShellEnv()])

    expect(execFileSync).toHaveBeenCalledTimes(2)
  })

  // -- cache isolation ------------------------------------------------------

  it('returns a copy so a caller mutating the result cannot poison the cache', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    const first = await refreshShellEnv()
    const pathKey = Object.keys(first).find((k) => k.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    // Simulate a consumer stripping vars in place (e.g. removeEnvProxy).
    delete first[pathKey as string]

    const second = await getShellEnv()
    expect(second[pathKey as string]).toBeDefined()
  })
})
