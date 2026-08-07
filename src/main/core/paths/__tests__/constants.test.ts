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
const REAL_PLATFORM = process.platform

function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function stubElectron({ isPackaged = false }: { isPackaged?: boolean } = {}) {
  const state = { logs: DEFAULT_LOGS }
  const setAppLogsPath = vi.fn((p: string) => {
    state.logs = p
  })
  const getPath = vi.fn((key: string) => {
    if (key === 'logs') return state.logs
    if (key === 'userData') return DEFAULT_USER_DATA
    return '/mock/unknown'
  })
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { isPackaged, getPath, setAppLogsPath }
  }))
  return { setAppLogsPath, getPath }
}

function loadConstants() {
  return import('../constants')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  vi.unstubAllEnvs()
  vi.doUnmock('electron')
})

describe('LOGS_DIR dev diversion', () => {
  it('packaged: leaves the platform default untouched', async () => {
    stubPlatform('darwin')
    const { setAppLogsPath } = stubElectron({ isPackaged: true })
    const { LOGS_DIR } = await loadConstants()
    expect(setAppLogsPath).not.toHaveBeenCalled()
    expect(LOGS_DIR).toBe(DEFAULT_LOGS)
  })

  it('dev macOS: suffixes the name-derived logs directory', async () => {
    stubPlatform('darwin')
    const { setAppLogsPath } = stubElectron()
    const { LOGS_DIR } = await loadConstants()
    expect(setAppLogsPath).toHaveBeenCalledWith(`${DEFAULT_LOGS}Dev`)
    expect(LOGS_DIR).toBe(`${DEFAULT_LOGS}Dev`)
  })

  it('dev Windows: nests logs under the suffixed userData', async () => {
    stubPlatform('win32')
    const { setAppLogsPath } = stubElectron()
    const { LOGS_DIR } = await loadConstants()
    const expected = path.join(`${DEFAULT_USER_DATA}Dev`, 'logs')
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
})
