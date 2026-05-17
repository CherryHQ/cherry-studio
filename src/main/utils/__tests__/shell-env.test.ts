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

// Mock findGitBash — returns null by default (no Git Bash installed)
vi.mock('@main/utils/git-bash', () => ({
  findGitBash: vi.fn().mockReturnValue(null)
}))

// Mock ConfigManager
vi.mock('@main/services/ConfigManager', () => ({
  ConfigKeys: {
    GitBashPath: 'gitBashPath',
    GitBashPathSource: 'gitBashPathSource'
  },
  configManager: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn()
  }
}))

// Import AFTER mocks are registered so the module binds to mocked values.
import { ConfigKeys, configManager } from '@main/services/ConfigManager'

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

  it('should not spawn any shell process when Git Bash is not found', async () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows')
      throw new Error('not found')
    })

    await refreshShellEnv()

    expect(spawn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Git Bash spawn tests
// ---------------------------------------------------------------------------

describe('shell-env – Windows Git Bash spawn', () => {
  const savedEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset configManager mock
    vi.mocked(configManager.get).mockReturnValue(undefined)
    process.env = {
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\TestUser',
      Path: 'C:\\StaleOldPath'
    }
  })

  afterEach(() => {
    process.env = savedEnv
  })

  // Helper: create a mock ChildProcess that emits 'close' with stdout
  function mockSpawnSuccess(stdout: string) {
    type ListenerFn = (...args: unknown[]) => void
    const listeners: Record<string, ListenerFn[]> = {}
    const mockChild = {
      kill: vi.fn(),
      stdout: { on: (_event: string, fn: ListenerFn) => { listeners['stdout'] = listeners['stdout'] || []; listeners['stdout'].push(fn) } },
      stderr: { on: (_event: string, fn: ListenerFn) => { listeners['stderr'] = listeners['stderr'] || []; listeners['stderr'].push(fn) } },
      on: (event: string, fn: ListenerFn) => { listeners[event] = listeners[event] || []; listeners[event].push(fn) }
    }
    vi.mocked(spawn).mockImplementation(() => {
      // Simulate async data and close events
      setTimeout(() => {
        listeners['stdout']?.forEach((fn) => fn(stdout))
        listeners['stderr']?.forEach((fn) => fn(''))
        listeners['close']?.forEach((fn) => fn(0))
      }, 0)
      return mockChild as any
    })
    return mockChild
  }

  // T006: Git Bash found → spawn with -ilc env (MSYS PATH format)
  it('should spawn bash with -ilc env and convert MSYS PATH to Windows', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Real Git Bash output: POSIX-style PATH with MSYS paths
    const bashEnvOutput = 'PATH=/c/Users/TestUser/.local/bin:/c/fnm/node/v22.0.0:/usr/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    // Registry returns system paths
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      ['-ilc', 'env'],
      expect.objectContaining({ shell: false })
    )
    // MSYS paths should be converted to Windows format
    const pathValue = env.PATH || env.Path || ''
    expect(pathValue).toContain('C:\\Users\\TestUser\\.local\\bin')
    expect(pathValue).toContain('C:\\fnm\\node\\v22.0.0')
    // Registry paths should be merged
    expect(pathValue).toContain('C:\\Windows\\system32')
  })

  // T007: Git Bash not found → fallback to registry
  it('should fall back to registry PATH when Git Bash is not found', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue(null)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(spawn).not.toHaveBeenCalled()
    expect(env.Path).toContain('C:\\Windows\\system32')
  })

  // T008: spawn failure → fallback to registry
  it('should fall back to registry PATH when bash spawn fails', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // spawn emits 'error' event
    type ListenerFn = (...args: unknown[]) => void
    const listeners: Record<string, ListenerFn[]> = {}
    vi.mocked(spawn).mockImplementation(() => {
      setTimeout(() => {
        listeners['error']?.forEach((fn) => fn(new Error('ENOENT')))
      }, 0)
      return {
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (event: string, fn: ListenerFn) => { listeners[event] = listeners[event] || []; listeners[event].push(fn) }
      } as any
    })

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\FallbackPath')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\FallbackPath')
  })

  // T009: spawn timeout → fallback to registry
  it('should fall back to registry PATH when bash spawn times out', async () => {
    vi.useFakeTimers()
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // spawn never resolves (hangs)
    vi.mocked(spawn).mockImplementation(() => ({
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    }) as any)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\TimeoutFallback')
      throw new Error('not found')
    })

    const promise = refreshShellEnv()

    // Advance past the 15s timeout
    vi.advanceTimersByTime(16_000)

    const env = await promise

    expect(env.Path).toContain('C:\\TimeoutFallback')

    vi.useRealTimers()
  })

  // T010: mergeWithRegistryPath preserves registry segments (MSYS PATH format)
  it('should merge registry PATH segments not present in bash env', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Real Git Bash output: POSIX-style PATH
    const bashEnvOutput = 'PATH=/c/fnm/node/v22.0.0:/c/Users/TestUser/.local/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    // Registry has system paths
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32;C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const pathValue = env.PATH || env.Path || ''
    // Both bash (converted) and registry paths should be present
    expect(pathValue).toContain('C:\\fnm\\node\\v22.0.0')
    expect(pathValue).toContain('C:\\Windows\\system32')
    // Bash paths should come before registry paths
    expect(pathValue.indexOf('C:\\fnm\\node\\v22.0.0')).toBeLessThan(pathValue.indexOf('C:\\Windows\\system32'))
  })

  // T011: verify dedup — registry segment already in bash env is not duplicated (MSYS PATH format)
  it('should not duplicate PATH segments already present from bash env', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Real Git Bash output: includes system32 as MSYS path
    const bashEnvOutput = 'PATH=/c/Windows/system32:/c/fnm/node/v22.0.0\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    // Registry also includes the same system path
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32;C:\\Windows')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const pathValue = env.PATH || env.Path || ''
    const segments = pathValue.split(';')
    const system32Count = segments.filter((s: string) => s.toLowerCase().includes('system32')).length
    expect(system32Count).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // P2: Configured Git Bash path tests
  // ---------------------------------------------------------------------------

  // T-P2-01: Configured Git Bash path from settings is used
  it('should use configured Git Bash path from settings', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')

    // Mock configManager to return configured path
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === ConfigKeys.GitBashPath) return 'D:\\CustomGit\\bin\\bash.exe'
      return undefined
    })

    // findGitBash returns the configured path (after validation)
    vi.mocked(findGitBash).mockReturnValue('D:\\CustomGit\\bin\\bash.exe')

    const bashEnvOutput = 'PATH=/c/Users/TestUser/.local/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    await refreshShellEnv()

    // findGitBash should be called WITH the configured path
    expect(findGitBash).toHaveBeenCalledWith('D:\\CustomGit\\bin\\bash.exe')
  })

  // T-P2-02: Configured path invalid falls back to auto-discovery
  it('should pass configured path to findGitBash even if invalid', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')

    // Mock configManager to return invalid path
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === ConfigKeys.GitBashPath) return 'D:\\NonExistent\\bash.exe'
      return undefined
    })

    // findGitBash returns null (invalid path), then auto-discovered path
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const bashEnvOutput = 'PATH=/c/Users/TestUser/.local/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    await refreshShellEnv()

    // findGitBash was called with configured path (it handles validation internally)
    expect(findGitBash).toHaveBeenCalledWith('D:\\NonExistent\\bash.exe')
  })

  // ---------------------------------------------------------------------------
  // MSYS PATH conversion edge case tests
  // ---------------------------------------------------------------------------

  // T-MSYS-01: Mixed MSYS and Windows paths
  it('should handle mixed MSYS and Windows paths in PATH', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Mixed format: some MSYS, some already Windows (colon-separated)
    const bashEnvOutput = 'PATH=/c/Users/TestUser/.local/bin:C:/Python39:/usr/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const pathValue = env.PATH || env.Path || ''
    expect(pathValue).toContain('C:\\Users\\TestUser\\.local\\bin')
    expect(pathValue).toContain('C:\\Python39')
  })

  // T-MSYS-02: Already Windows PATH (semicolon-separated) - skip conversion
  it('should skip MSYS conversion when PATH is already Windows-style', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Already Windows format (has ; separator)
    const bashEnvOutput = 'PATH=C:\\fnm\\node\\v22.0.0;C:\\Users\\TestUser\\.local\\bin\nHOME=C:\\Users\\TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()

    const pathValue = env.PATH || env.Path || ''
    expect(pathValue).toContain('C:\\fnm\\node\\v22.0.0')
    expect(pathValue).toContain('C:\\Users\\TestUser\\.local\\bin')
  })

  // T-MSYS-03: MSYS-internal paths are filtered out
  it('should filter out MSYS-internal paths from PATH', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // PATH includes MSYS-internal entries alongside valid MSYS drive paths
    const bashEnvOutput =
      'PATH=/c/Users/TestUser/.local/bin:/usr/bin:/usr/local/bin:/mingw64/bin:/bin:/cmd:/c/fnm/node/v22.0.0\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY) return regOutput(keyPath, 'C:\\Windows\\system32')
      throw new Error('not found')
    })

    const env = await refreshShellEnv()
    const pathValue = env.PATH || env.Path || ''

    // Valid MSYS drive paths should be present
    expect(pathValue.toLowerCase()).toContain('c:\\users\\testuser\\.local\\bin')
    expect(pathValue.toLowerCase()).toContain('c:\\fnm\\node\\v22.0.0')

    // MSYS-internal paths should be filtered out — check as standalone segments
    const segments = pathValue.split(';').map((s: string) => s.toLowerCase().trim())
    expect(segments).not.toContain('/usr/bin')
    expect(segments).not.toContain('/usr/local/bin')
    expect(segments).not.toContain('/mingw64/bin')
    expect(segments).not.toContain('/bin')
    expect(segments).not.toContain('/cmd')
  })

  // T-P2-03: spawn receives fresh registry PATH as env
  it('should pass fresh registry PATH to bash spawn env', async () => {
    const { findGitBash } = await import('@main/utils/git-bash')
    vi.mocked(findGitBash).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    // Registry returns a path with a newly installed tool
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const keyPath = (args as string[])[1]
      if (keyPath === HKLM_KEY)
        return regOutput(keyPath, 'C:\\Windows\\system32;C:\\NewTool\\bin')
      throw new Error('not found')
    })

    const bashEnvOutput = 'PATH=/c/Users/TestUser/.local/bin\nHOME=/c/Users/TestUser\n'
    mockSpawnSuccess(bashEnvOutput)

    await refreshShellEnv()

    // spawn should have been called with an env option containing the fresh registry PATH
    const spawnOptions = vi.mocked(spawn).mock.calls[0][2]
    expect(spawnOptions?.env).toBeDefined()
    const spawnEnv = spawnOptions!.env as Record<string, string>
    const spawnPath = spawnEnv.Path || spawnEnv.PATH || ''
    expect(spawnPath).toContain('C:\\NewTool\\bin')
  })
})
