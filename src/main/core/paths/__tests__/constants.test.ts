import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/paths/constants.ts
 *
 * LOGS_DIR is captured at module evaluation, so every case resets the module
 * registry, stubs `electron` via `vi.doMock`, and dynamically re-imports the
 * module. The stub routes setAppLogsPath() back into later getPath('logs')
 * reads the way Electron does, so the LOGS_DIR assertions inherently verify
 * the dev diversion runs BEFORE the final capture — if the capture ever moved
 * above the setter, LOGS_DIR would come back as the undiverted default.
 */

const DEFAULT_LOGS = '/default/Logs/CherryStudio'
const DEFAULT_USER_DATA = '/default/userData/CherryStudio'
const DEV_PROFILE_ROOT = '/private/tmp/cherry-profile'
const REAL_PLATFORM = process.platform

function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function stubElectron({
  isPackaged = false,
  userData = DEFAULT_USER_DATA
}: {
  isPackaged?: boolean
  userData?: string
} = {}) {
  const state = { logs: DEFAULT_LOGS }
  const setAppLogsPath = vi.fn((p: string) => {
    state.logs = p
  })
  const getPath = vi.fn((key: string) => {
    if (key === 'logs') return state.logs
    if (key === 'userData') return userData
    return '/mock/unknown'
  })
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { isPackaged, getPath, setAppLogsPath }
  }))
  return { setAppLogsPath, getPath }
}

// Stubbing process.platform does not switch the already-loaded `node:path`
// implementation, so the win32 case must swap the module for `path.win32` to
// exercise real Windows join/normalization semantics on any host. Callers
// must vi.doUnmock('node:path') before the test ends so later cases see the
// host implementation again.
function stubWin32Path() {
  vi.doMock('node:path', () => ({ ...path.win32, default: path.win32 }))
}

function loadConstants() {
  return import('../constants')
}

beforeEach(() => {
  vi.resetModules()
})

// Deliberately no vi.doUnmock('electron') here: every test re-registers the
// mock via stubElectron() before importing, while unmock/remock churn leaves
// a registry window in which a dynamic import intermittently falls through to
// the real electron package (observed as flaky `app === undefined` failures).
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  vi.unstubAllEnvs()
})

describe('LOGS_DIR dev diversion', () => {
  it('packaged: ignores even an unsafe dev profile root and leaves platform defaults untouched', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_PROFILE_ROOT', 'relative/profile')
    const { setAppLogsPath } = stubElectron({ isPackaged: true })
    const { CHERRY_HOME, LOGS_DIR } = await loadConstants()
    expect(setAppLogsPath).not.toHaveBeenCalled()
    expect(CHERRY_HOME).toBe(path.join(os.homedir(), '.cherrystudio'))
    expect(LOGS_DIR).toBe(DEFAULT_LOGS)
  })

  it('dev profile root keeps Cherry home, BootConfig, userData, and logs outside the real home', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_PROFILE_ROOT', `  ${DEV_PROFILE_ROOT}  `)
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', 'IgnoredWhenRootIsSet')
    const { setAppLogsPath } = stubElectron()

    const { BOOT_CONFIG_PATH, CHERRY_HOME, LOGS_DIR, resolveDevUserDataPath } = await loadConstants()

    const isolatedPaths = [CHERRY_HOME, BOOT_CONFIG_PATH, resolveDevUserDataPath(), LOGS_DIR]
    expect(isolatedPaths).toEqual([
      path.join(DEV_PROFILE_ROOT, '.cherrystudio'),
      path.join(DEV_PROFILE_ROOT, '.cherrystudio', 'boot-config.json'),
      path.join(DEV_PROFILE_ROOT, 'userData'),
      path.join(DEV_PROFILE_ROOT, 'logs')
    ])
    const normalizedProfileRoot = path.normalize(DEV_PROFILE_ROOT)
    expect(
      isolatedPaths.every((value) => {
        const relative = path.relative(normalizedProfileRoot, value)
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
      })
    ).toBe(true)
    expect(isolatedPaths.every((value) => !value.startsWith(os.homedir()))).toBe(true)
    expect(setAppLogsPath).toHaveBeenCalledWith(path.join(DEV_PROFILE_ROOT, 'logs'))
  })

  it('dev macOS: suffixes the name-derived logs directory', async () => {
    stubPlatform('darwin')
    const { setAppLogsPath } = stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(setAppLogsPath).toHaveBeenCalledWith(`${DEFAULT_LOGS}Dev`)
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}Dev`)
  })

  it('dev Windows: nests logs under the suffixed userData (win32 semantics)', async () => {
    stubPlatform('win32')
    stubWin32Path()
    const { setAppLogsPath } = stubElectron({ userData: 'C:\\Users\\dev\\AppData\\Roaming\\CherryStudio' })
    const { LOGS_DIR } = await loadConstants()
    vi.doUnmock('node:path')
    const expected = 'C:\\Users\\dev\\AppData\\Roaming\\CherryStudioDev\\logs'
    expect(setAppLogsPath).toHaveBeenCalledWith(expected)
    expect(LOGS_DIR).toBe(expected)
  })

  it('dev Linux: nests logs under the suffixed userData', async () => {
    stubPlatform('linux')
    stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(LOGS_DIR).toBe(path.join(`${DEFAULT_USER_DATA}Dev`, 'logs'))
  })

  it('dev: honors the configured CS_DEV_USER_DATA_SUFFIX', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', 'DevQuito')
    stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}DevQuito`)
  })

  it('dev: blank configured suffix falls back to Dev', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', '   ')
    stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}Dev`)
  })

  it('dev: a traversal suffix aborts startup instead of collapsing LOGS_DIR onto the packaged directory', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', '/../CherryStudio')
    stubElectron()
    await expect(loadConstants()).rejects.toThrow(/single path component/)
  })
})

// Falling back to `Dev` would silently merge a profile meant to be isolated
// into the shared dev one, so an unusable suffix has to stop the run.
describe('CS_DEV_USER_DATA_SUFFIX validation', () => {
  it.each([
    ['/../CherryStudio', 'POSIX traversal'],
    ['\\..\\CherryStudio', 'Windows traversal'],
    ['sub/dir', 'path separator'],
    ['C:', 'drive colon'],
    ['Dev|1', 'Windows-forbidden character'],
    ['Dev\u0007', 'control character'],
    ['.', 'single dot (Windows strips trailing dots)'],
    ['..', 'dots-only traversal'],
    ['Dev.', 'trailing dot']
  ])('aborts startup for %j (%s)', async (value) => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', value)
    stubElectron()
    await expect(loadConstants()).rejects.toThrow(/single path component/)
  })

  // Spaces and non-ASCII are legal inside one component on every platform we
  // ship, so they must survive validation.
  it.each([['Dev2'], ['dev-agent_1'], ['.Dev'], ['2.0-rc.1'], ['Dev Oslo'], ['开发']])(
    'accepts path component %j',
    async (value) => {
      stubPlatform('darwin')
      vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', value)
      stubElectron()
      const { LOGS_DIR } = await loadConstants()
      expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}${value}`)
    }
  )

  it('trims surrounding whitespace before validating', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', '  Dev2  ')
    stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}Dev2`)
  })
})

describe('CS_DEV_PROFILE_ROOT validation', () => {
  it.each([['relative/profile'], ['/']])('aborts startup for unsafe root %j', async (value) => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_PROFILE_ROOT', value)
    stubElectron()
    await expect(loadConstants()).rejects.toThrow(/CS_DEV_PROFILE_ROOT/)
  })

  it('blank values preserve the existing suffix behavior', async () => {
    stubPlatform('darwin')
    vi.stubEnv('CS_DEV_PROFILE_ROOT', '   ')
    vi.stubEnv('CS_DEV_USER_DATA_SUFFIX', 'DevQuito')
    stubElectron()
    const { CHERRY_HOME, LOGS_DIR, resolveDevUserDataPath } = await loadConstants()
    expect(CHERRY_HOME).toBe(path.join(os.homedir(), '.cherrystudio'))
    expect(resolveDevUserDataPath()).toBe(`${DEFAULT_USER_DATA}DevQuito`)
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}DevQuito`)
  })
})
