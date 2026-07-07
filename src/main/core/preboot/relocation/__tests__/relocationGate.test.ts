import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/relocation/relocationGate.ts
 *
 * Covers the gate's decision logic (skip vs handled) and the success/failure
 * paths. The actual file-copy is exercised against a mocked fs that returns
 * an empty tree, so we validate the orchestration (pre-flight → copy →
 * commit → progress → persisted status) without touching real disk.
 */

const whenReady = vi.fn().mockResolvedValue(undefined)
const ipcHandle = vi.fn()

const wm = {
  create: vi.fn(),
  waitForReady: vi.fn().mockResolvedValue(undefined),
  sendProgress: vi.fn(),
  restartApp: vi.fn()
}

const commitRelocation = vi.fn()

const bootConfigGet = vi.fn()
const bootConfigSet = vi.fn()
const bootConfigFlush = vi.fn()
const applicationGetPath = vi.fn()

type Relocation = NonNullable<
  | { status: 'pending'; from: string; to: string; copy: boolean }
  | { status: 'failed'; from: string; to: string; error: string; failedAt: string }
  | null
>

function stubElectron(isPackaged: boolean) {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: { isPackaged, whenReady },
    ipcMain: { handle: ipcHandle }
  }))
}

function stubBootConfig(relocation: Relocation | null) {
  const store: Record<string, unknown> = { 'temp.user_data_relocation': relocation }
  bootConfigGet.mockImplementation((key: string) => store[key])
  bootConfigSet.mockImplementation((key: string, value: unknown) => {
    store[key] = value
  })
  bootConfigFlush.mockImplementation(() => undefined)
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: { get: bootConfigGet, set: bootConfigSet, flush: bootConfigFlush }
  }))
  return store
}

function stubFsAndFsp(
  overrides: Partial<
    Record<'existsSync' | 'accessSync' | 'statSync' | 'readdir' | 'stat' | 'statfs' | 'mkdir' | 'copyFile' | 'rm', ReturnType<typeof vi.fn>>
  > = {}
) {
  vi.doMock('node:fs', () => {
    const m = {
      existsSync: overrides.existsSync ?? vi.fn(() => true),
      accessSync: overrides.accessSync ?? vi.fn(() => undefined),
      statSync: overrides.statSync ?? vi.fn(() => ({ dev: 1 })),
      constants: { W_OK: 2 }
    }
    return { ...m, default: m }
  })
  vi.doMock('node:fs/promises', () => ({
    __esModule: true,
    default: {
      readdir: overrides.readdir ?? vi.fn(async () => []),
      stat: overrides.stat ?? vi.fn(async () => ({ size: 0 })),
      statfs: overrides.statfs ?? vi.fn(async () => ({ bavail: 1024, bsize: 1024 })),
      mkdir: overrides.mkdir ?? vi.fn(async () => undefined),
      copyFile: overrides.copyFile ?? vi.fn(async () => undefined),
      rm: overrides.rm ?? vi.fn(async () => undefined),
      symlink: vi.fn(async () => undefined),
      readlink: vi.fn(async () => '')
    }
  }))
}

function stubDeps(options: { installPath?: string; isWin?: boolean } = {}) {
  applicationGetPath.mockReturnValue(options.installPath ?? '/Applications/Cherry Studio.app/Contents/MacOS')
  vi.doMock('@application', () => ({ application: { getPath: applicationGetPath } }))
  vi.doMock('@main/core/platform', () => ({ isWin: options.isWin ?? false }))
  vi.doMock('@main/core/preboot/userDataLocation', () => ({ commitRelocation }))
  vi.doMock('@main/core/preboot/relocation/RelocationWindowManager', () => ({
    __esModule: true,
    relocationWindowManager: wm
  }))
}

async function loadGate() {
  return import('../relocationGate')
}

beforeEach(() => {
  vi.resetModules()
  whenReady.mockReset().mockResolvedValue(undefined)
  ipcHandle.mockReset()
  wm.create.mockReset()
  wm.waitForReady.mockReset().mockResolvedValue(undefined)
  wm.sendProgress.mockReset()
  wm.restartApp.mockReset()
  commitRelocation.mockReset()
  bootConfigGet.mockReset()
  bootConfigSet.mockReset()
  bootConfigFlush.mockReset()
  applicationGetPath.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runUserDataRelocationGate', () => {
  it('returns skipped in dev (unpackaged) even if a pending request exists', async () => {
    stubElectron(false)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('skipped')
    expect(wm.create).not.toHaveBeenCalled()
  })

  it('returns skipped when no relocation request is present', async () => {
    stubElectron(true)
    stubBootConfig(null)
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('skipped')
    expect(wm.create).not.toHaveBeenCalled()
  })

  it('clears and skips when a previous relocation is in the failed state', async () => {
    stubElectron(true)
    const store = stubBootConfig({
      status: 'failed',
      from: '/old',
      to: '/new/data',
      error: 'boom',
      failedAt: '2026-06-29T00:00:00.000Z'
    })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('skipped')
    expect(wm.create).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toBeNull()
    expect(bootConfigFlush).toHaveBeenCalled()
  })

  it('pending + copy=false: commits the new path and reports completed (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.create).toHaveBeenCalled()
    // No copy → no copying stage emitted; jump straight to committing/completed.
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('pending + copy=false: preflight failure persists failed status and no commit', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/same', to: '/same', copy: false })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/same',
      to: '/same',
      error: expect.stringMatching(/same path/i)
    })
  })

  it('pending + copy=true: runs the copy then commits (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'copying' }))
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('preflight failure (from === to): persists failed status, reports failed, no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/same', to: '/same', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/same',
      to: '/same',
      error: expect.stringMatching(/same path/i)
    })
    expect(bootConfigFlush).toHaveBeenCalled()
    expect(wm.sendProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'failed', error: expect.stringMatching(/same path/i) })
    )
  })

  it('preflight failure (from inside to): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/parent/new/old', to: '/parent/new', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/parent/new/old',
      to: '/parent/new',
      error: expect.stringMatching(/source is inside target/i)
    })
  })

  it('preflight failure (target is root): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/root or top-level path/i)
    })
  })

  it('preflight failure (target is mounted volume root): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/Volumes/ExternalDrive', copy: true })
    stubFsAndFsp({
      statSync: vi.fn((p: string) => ({ dev: p === '/Volumes/ExternalDrive' ? 2 : 1 }))
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/mounted volume root/i)
    })
  })

  it('preflight failure (target inside app install path): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({
      status: 'pending',
      from: '/old',
      to: '/Applications/Cherry Studio.app/Contents/MacOS/Data',
      copy: true
    })
    stubFsAndFsp()
    stubDeps({ installPath: '/Applications/Cherry Studio.app/Contents/MacOS' })
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(applicationGetPath).toHaveBeenCalledWith('app.install')
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/app install path/i)
    })
  })

  it('preflight failure (Windows path case differs only): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({
      status: 'pending',
      from: 'C:\\Users\\me\\CherryData',
      to: 'c:\\users\\me\\cherrydata',
      copy: false
    })
    stubFsAndFsp()
    stubDeps({ installPath: 'C:\\Program Files\\Cherry Studio', isWin: true })
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/same path/i)
    })
  })

  it('copy failure persists failed status and does not commit', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const copyError = new Error('copy failed')
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdir: vi.fn(async () => [fileEntry]),
      stat: vi.fn(async () => ({ size: 10 })),
      copyFile: vi.fn(async () => {
        throw copyError
      })
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/old',
      to: '/new/data',
      error: 'copy failed'
    })
  })

  it('copy failure removes the partial target tree before reporting failed', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdir: vi.fn(async () => [fileEntry]),
      stat: vi.fn(async () => ({ size: 10 })),
      rm,
      copyFile: vi.fn(async () => {
        throw new Error('copy failed')
      })
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(rm).toHaveBeenCalledWith('/new/data', { recursive: true, force: true })
    expect(rm).toHaveBeenCalledTimes(2)
  })

  it('copy=true: fails before copying when target volume has insufficient free space', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const copyFile = vi.fn(async () => undefined)
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdir: vi.fn(async () => [fileEntry]),
      stat: vi.fn(async () => ({ size: 10 })),
      statfs: vi.fn(async () => ({ bavail: 1, bsize: 1 })),
      copyFile,
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(copyFile).not.toHaveBeenCalled()
    expect(rm).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not have enough free space/i)
    })
  })
})
