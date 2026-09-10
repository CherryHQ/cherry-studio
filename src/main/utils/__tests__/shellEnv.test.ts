import { execFile, spawn } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { enumerateValuesSafeMock } = vi.hoisted(() => ({
  enumerateValuesSafeMock: vi.fn()
}))

// Force Windows code path regardless of the host platform.
vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  mocked.application.getPath = vi.fn((key: string) => {
    if (key === 'cherry.bin') return 'C:\\Users\\test\\.cherrystudio\\bin'
    if (key === 'feature.binary.data') {
      return 'C:\\Users\\test\\AppData\\Roaming\\CherryStudio\\Toolchain\\mise'
    }
    if (key === 'sys.home') return 'C:\\Users\\test'
    return `/mock/${key}`
  })
  return mocked
})

vi.mock('child_process')

vi.mock('registry-js', () => ({
  HKEY: {
    HKEY_LOCAL_MACHINE: 'HKEY_LOCAL_MACHINE',
    HKEY_CURRENT_USER: 'HKEY_CURRENT_USER'
  },
  RegistryValueType: {
    REG_SZ: 'REG_SZ',
    REG_EXPAND_SZ: 'REG_EXPAND_SZ'
  },
  enumerateValuesSafe: enumerateValuesSafeMock
}))

// Control the bundled-git resolution; default null so most tests see no bundled
// git appended (matching a build/host without the Windows MinGit bundle).
vi.mock('../bundledGit', () => ({
  getBundledGitPath: vi.fn(() => null),
  getBundledGitDir: vi.fn(() => null)
}))

// Import AFTER mocks are registered so the module binds to mocked values.
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { getBundledGitDir } from '../bundledGit'
import { getPathFromEnvironment, getRawShellEnv, getShellEnv, refreshShellEnv } from '../shellEnv'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HKLM_HIVE = 'HKEY_LOCAL_MACHINE'
const HKCU_HIVE = 'HKEY_CURRENT_USER'
const HKLM_KEY = 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const HKCU_KEY = 'Environment'

function mockRegistryPaths({
  system,
  user,
  type = 'REG_EXPAND_SZ'
}: {
  system?: string
  user?: string
  type?: 'REG_SZ' | 'REG_EXPAND_SZ'
} = {}): void {
  enumerateValuesSafeMock.mockImplementation((hive: string, keyPath: string) => {
    if (hive === HKLM_HIVE && keyPath === HKLM_KEY && system !== undefined) {
      return [{ name: 'Path', type, data: system }]
    }
    if (hive === HKCU_HIVE && keyPath === HKCU_KEY && user !== undefined) {
      return [{ name: 'Path', type, data: user }]
    }
    return []
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shellEnv – Windows registry PATH', () => {
  const savedEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainCacheServiceUtils.resetMocks()

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
    mockRegistryPaths({ system: 'C:\\Windows\\system32;C:\\Windows;C:\\NodeJS' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\NodeJS')
    expect(env.Path).not.toContain('C:\\StaleOldPath')
  })

  it('should combine system and user PATH with semicolon', async () => {
    mockRegistryPaths({ system: 'C:\\System', user: 'C:\\User' })

    const env = await refreshShellEnv()

    // System PATH comes first, user PATH second.
    const pathValue = [env.Path, env.PATH].filter(Boolean).join(';')
    expect(pathValue).toContain('C:\\System')
    expect(pathValue).toContain('C:\\User')
    expect(pathValue).toContain('C:\\System;C:\\User')
  })

  it('preserves Unicode registry PATH values without invoking reg.exe', async () => {
    mockRegistryPaths({ system: 'D:\\开发工具\\nodejs' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('D:\\开发工具\\nodejs')
    expect(enumerateValuesSafeMock).toHaveBeenCalledWith(HKLM_HIVE, HKLM_KEY)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('should use only user PATH when system PATH is unavailable', async () => {
    mockRegistryPaths({ user: 'C:\\UserOnly' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\UserOnly')
  })

  it('should fall back to process.env PATH when both registry reads fail', async () => {
    mockRegistryPaths()

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\StaleOldPath')
  })

  it('should not record an unreadable registry as the last known good env', async () => {
    mockRegistryPaths({ system: 'C:\\Windows;C:\\NodeJS' })
    await getShellEnv()

    // process.env holds the boot-time PATH — the very value the registry read
    // exists to replace, so a failed read must not pass as a capture.
    mockRegistryPaths()
    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\NodeJS')
    expect(env.Path).not.toContain('C:\\StaleOldPath')
    expect(MockMainCacheServiceUtils.getCacheValue<Record<string, string>>('system.shell_env.last_good')?.Path).toBe(
      'C:\\Windows;C:\\NodeJS'
    )
  })

  // -- %VAR% expansion ------------------------------------------------------

  it('should expand %SystemRoot% in registry PATH', async () => {
    mockRegistryPaths({ system: '%SystemRoot%\\system32' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\Windows\\system32')
    expect(env.Path).not.toContain('%SystemRoot%')
  })

  it('should preserve unknown %VAR% references unexpanded', async () => {
    mockRegistryPaths({ system: '%UNKNOWN_VAR%\\bin' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('%UNKNOWN_VAR%')
  })

  it('should expand variables case-insensitively', async () => {
    mockRegistryPaths({ system: '%systemroot%\\system32' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\Windows\\system32')
  })

  // -- REG_SZ (no expand) ---------------------------------------------------

  it('should handle REG_SZ values without %VAR% expansion needed', async () => {
    mockRegistryPaths({ system: 'C:\\PlainPath', type: 'REG_SZ' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('C:\\PlainPath')
  })

  // -- Cherry Studio tool directories appended ------------------------------

  it('should preserve the unmodified user environment for system tools', async () => {
    process.env.MISE_DATA_DIR = 'C:\\Users\\TestUser\\mise-data'
    mockRegistryPaths({ system: 'C:\\Windows;C:\\UserNode' })

    await refreshShellEnv()
    const env = await getRawShellEnv()

    expect(env.MISE_DATA_DIR).toBe('C:\\Users\\TestUser\\mise-data')
    expect(env.Path).toBe('C:\\Windows;C:\\UserNode')
    expect(env.Path).not.toContain('.cherrystudio')
  })

  it('should append Cherry Studio tool directories to PATH', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })

    const env = await refreshShellEnv()

    expect(env.Path).toContain('.cherrystudio')
    expect(env.Path).toContain('Toolchain\\mise')
    expect(env.Path).toContain('shims')
    expect(env.Path).toContain('bin')
  })

  it('lists the mise shims dir only once despite appending and prepending it', async () => {
    // appendCherryToolDirsToPath() adds the shims dir, then mergeBinaryExecutionEnv()
    // prepends it again — the merge step must dedup so it does not appear twice.
    mockRegistryPaths({ system: 'C:\\Windows' })

    const env = await refreshShellEnv()

    const shimsCount = env.Path.split(';').filter((seg) => seg.endsWith('shims')).length
    expect(shimsCount).toBe(1)
  })

  it('appends the bundled MinGit dir to the PATH tail as a last-resort git', async () => {
    const bundledGitDir = 'C:\\Cherry\\resources\\binaries\\win32-x64\\git\\cmd'
    vi.mocked(getBundledGitDir).mockReturnValue(bundledGitDir)
    mockRegistryPaths({ system: 'C:\\Git\\cmd;C:\\Windows' })

    const env = await refreshShellEnv()

    const segments = env.Path.split(';')
    // Present, and dead last so system git (C:\Git\cmd) and the managed tool dirs win ahead of it.
    expect(segments[segments.length - 1]).toBe(bundledGitDir)
    expect(segments.indexOf('C:\\Git\\cmd')).toBeLessThan(segments.length - 1)
  })

  // -- does not spawn cmd.exe -----------------------------------------------

  it('should not spawn cmd.exe or any shell process', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })

    await refreshShellEnv()

    expect(spawn).not.toHaveBeenCalled()
  })

  // -- concurrent dedup -----------------------------------------------------

  it('should collapse overlapping reads onto a single env resolution', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })

    // getWindowsEnvironment() reads HKLM + HKCU, i.e. two registry calls
    // per resolution. Overlapping readers must share one resolution → 2 calls.
    await Promise.all([getShellEnv(), getShellEnv(), getRawShellEnv()])

    expect(enumerateValuesSafeMock).toHaveBeenCalledTimes(2)
  })

  it('should resolve the env again for an explicit refresh', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })
    await getShellEnv()

    // Callers refresh to observe a tool they just installed, so a refresh may
    // never be served from the cache → a second resolution, i.e. 4 calls.
    await refreshShellEnv()

    expect(enumerateValuesSafeMock).toHaveBeenCalledTimes(4)
  })

  // -- staleness ------------------------------------------------------------

  it('serves a tool installed after launch to a fresh read', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })
    await getShellEnv()

    // User installs a tool (e.g. ffmpeg) and it lands in the system PATH, then
    // activates an MCP server that needs it — no app restart in between.
    mockRegistryPaths({ system: 'C:\\Windows;C:\\ffmpeg\\bin' })

    const env = await getShellEnv({ fresh: true })
    expect(env.Path).toContain('C:\\ffmpeg\\bin')
  })

  // -- cache isolation ------------------------------------------------------

  it('returns a copy so a caller mutating the result cannot poison the cache', async () => {
    mockRegistryPaths({ system: 'C:\\Windows' })

    const first = await refreshShellEnv()
    const pathKey = Object.keys(first).find((k) => k.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    // Simulate a consumer stripping vars in place (e.g. removeEnvProxy).
    delete first[pathKey as string]

    const second = await getShellEnv()
    expect(second[pathKey as string]).toBeDefined()
  })
})

describe('getPathFromEnvironment', () => {
  it('reads PATH keys case-insensitively without copying unrelated values', () => {
    expect(getPathFromEnvironment({ Path: 'C:\\Users\\tester\\bin', SECRET: 'hidden' })).toBe('C:\\Users\\tester\\bin')
    expect(getPathFromEnvironment({ PATH: '/opt/homebrew/bin' })).toBe('/opt/homebrew/bin')
    expect(getPathFromEnvironment({ HOME: '/Users/tester' })).toBeUndefined()
  })
})
