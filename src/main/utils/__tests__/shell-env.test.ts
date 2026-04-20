import { execFileSync, spawn } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Force Windows code path regardless of the host platform.
vi.mock('@main/constant', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('child_process')

// Import AFTER mocks are registered so the module binds to mocked values.
import { refreshShellEnv } from '../shell-env'

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

describe('shell-env – Windows registry PATH', () => {
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
    const pathValue = env.Path
    expect(pathValue).toContain('C:\\System')
    expect(pathValue).toContain('C:\\User')
    expect(pathValue.indexOf('C:\\System')).toBeLessThan(pathValue.indexOf('C:\\User'))
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

  // -- Cherry Studio bin appended -------------------------------------------

  it('should append Cherry Studio bin directory to PATH', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('.cherrystudio')
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
})
