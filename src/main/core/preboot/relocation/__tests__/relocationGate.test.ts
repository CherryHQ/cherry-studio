import realFsp from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/relocation/relocationGate.ts
 *
 * Covers the gate's decision logic (skip vs handled) and the success/failure
 * paths. Most tests use mocked fs calls to validate orchestration
 * (pre-flight → copy → commit → progress → persisted status); one focused
 * test uses a real temporary directory for destructive replacement behavior.
 */

const whenReady = vi.fn().mockResolvedValue(undefined)
const ipcHandle = vi.fn()
const showMessageBoxSync = vi.fn()

const wm = {
  hasWindow: vi.fn(() => true),
  create: vi.fn(),
  waitForReady: vi.fn().mockResolvedValue(undefined),
  sendProgress: vi.fn(),
  restartApp: vi.fn(),
  shouldRestartAfterTerminalFailure: vi.fn(() => false)
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
    dialog: { showMessageBoxSync },
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
    Record<
      | 'existsSync'
      | 'accessSync'
      | 'lstatSync'
      | 'statSync'
      | 'readdirSync'
      | 'realpathSync'
      | 'readdir'
      | 'stat'
      | 'statfs'
      | 'mkdir'
      | 'copyFile'
      | 'rm'
      | 'rename',
      ReturnType<typeof vi.fn>
    >
  > = {}
) {
  vi.doMock('node:fs', () => {
    const realpathSync = overrides.realpathSync ?? vi.fn((p: string) => p)
    ;(realpathSync as ReturnType<typeof vi.fn> & { native?: ReturnType<typeof vi.fn> }).native = realpathSync
    const m = {
      existsSync: overrides.existsSync ?? vi.fn(() => true),
      accessSync: overrides.accessSync ?? vi.fn(() => undefined),
      lstatSync: overrides.lstatSync ?? vi.fn(() => ({ isSymbolicLink: () => false })),
      statSync: overrides.statSync ?? vi.fn(() => ({ dev: 1, isDirectory: () => true })),
      readdirSync: overrides.readdirSync ?? vi.fn(() => []),
      realpathSync,
      constants: { W_OK: 2, R_OK: 4 }
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
      rename: overrides.rename ?? vi.fn(async () => undefined),
      symlink: vi.fn(async () => undefined),
      readlink: vi.fn(async () => '')
    }
  }))
}

function useRealFsAndFsp() {
  vi.doMock('node:fs', async () => {
    const actual = await vi.importActual('node:fs')
    return { ...actual, default: actual }
  })
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual('node:fs/promises')
    return { ...actual, default: actual }
  })
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
  showMessageBoxSync.mockReset()
  wm.create.mockReset()
  wm.hasWindow.mockReset().mockReturnValue(true)
  wm.waitForReady.mockReset().mockResolvedValue(undefined)
  wm.sendProgress.mockReset()
  wm.restartApp.mockReset()
  wm.shouldRestartAfterTerminalFailure.mockReset().mockReturnValue(false)
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
    expect(showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        detail: expect.stringContaining('boom')
      })
    )
    expect(store['temp.user_data_relocation']).toBeNull()
    expect(bootConfigFlush).toHaveBeenCalled()
  })

  it('pending + copy=false: commits the new path, restarts immediately (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.create).toHaveBeenCalled()
    // No copy → no copying stage emitted; commit then restart immediately.
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
    expect(wm.restartApp).toHaveBeenCalled()
  })

  it('ready barrier failure persists failed status and restarts headlessly', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp()
    stubDeps()
    wm.waitForReady.mockRejectedValue(new Error('Relocation window failed to load: ERR_ABORTED'))
    wm.shouldRestartAfterTerminalFailure.mockReturnValue(true)

    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()

    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/old',
      to: '/new/data',
      error: expect.stringMatching(/failed to load/i)
    })
    expect(wm.sendProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'failed', error: expect.stringMatching(/failed to load/i) })
    )
    expect(wm.restartApp).toHaveBeenCalledTimes(1)
  })

  it('window creation failure persists failed status and restarts headlessly', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp()
    stubDeps()
    wm.create.mockImplementation(() => {
      throw new Error('BrowserWindow failed')
    })
    wm.hasWindow.mockReturnValue(false)

    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()

    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      from: '/old',
      to: '/new/data',
      error: 'BrowserWindow failed'
    })
    expect(wm.restartApp).toHaveBeenCalledTimes(1)
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

  it('pending + copy=false: rejects a missing switch target before commit', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      existsSync: vi.fn((p: string) => p !== '/new/data')
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/switch target directory does not exist/i)
    })
  })

  it('pending + copy=false: rejects a switch target that is not a directory before commit', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      statSync: vi.fn((p: string) => ({ dev: 1, isDirectory: () => p !== '/new/data' }))
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not a directory/i)
    })
  })

  it('pending + copy=false: rejects an unwritable switch target before commit', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      accessSync: vi.fn((p: string) => {
        if (p === '/new/data') {
          throw new Error('EACCES')
        }
      })
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not writable.*EACCES/i)
    })
  })

  it('pending + copy=false: rejects a non-empty switch target without Cherry userData markers', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      readdirSync: vi.fn((p: string) => (p === '/new/data' ? ['foreign-file'] : []))
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not recognized as Cherry Studio userData/i)
    })
  })

  it('pending + copy=false: allows a non-empty switch target with Cherry userData markers', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      readdirSync: vi.fn((p: string) => {
        if (p === '/new/data') return ['Data']
        if (p === '/new/data/Data') return ['Files']
        return []
      })
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
    expect(wm.restartApp).toHaveBeenCalled()
  })

  it('pending + copy=false: commits even when the old source path is inaccessible', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: false })
    stubFsAndFsp({
      existsSync: vi.fn((p: string) => p !== '/old')
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
  })

  it('pending + copy=true: runs the copy, commits, then restarts immediately (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'copying' }))
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
    expect(wm.restartApp).toHaveBeenCalled()
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
      to: '/Users/alice/Cherry Studio/Data',
      copy: true
    })
    stubFsAndFsp()
    stubDeps({ installPath: '/Users/alice/Cherry Studio' })
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

  it('preflight failure (target is a v1 protected system root): persists failed status and no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/System', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/root or top-level path|protected system path/i)
    })
  })

  it('preflight failure (copy to non-empty target without overwrite confirmation): no target removal and no commit', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdirSync: vi.fn((p: string) => (p === '/new/data' ? ['foreign-file'] : [])),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not empty.*overwrite was not confirmed/i)
    })
  })

  it('copy to non-empty target is allowed after explicit overwrite confirmation', async () => {
    const rm = vi.fn(async () => undefined)
    const rename = vi.fn(async () => undefined)
    stubElectron(true)
    showMessageBoxSync.mockReturnValueOnce(1)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdirSync: vi.fn((p: string) => (p === '/new/data' ? ['foreign-file'] : [])),
      rm,
      rename
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(showMessageBoxSync).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['Cancel', 'Overwrite'] }))
    expect(rename).toHaveBeenCalledWith('/new/data', expect.stringMatching(/\.data\.relocation-backup-/))
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.data\.relocation-/), '/new/data')
    expect(commitRelocation).toHaveBeenCalledWith('/new/data')
  })

  it('copy to non-empty target replaces stale files and preserves symlinks on disk', async () => {
    const root = await realFsp.mkdtemp(path.join('/tmp', 'relocation-gate-'))
    try {
      const from = path.join(root, 'old-data')
      const to = path.join(root, 'new-data')
      await realFsp.mkdir(path.join(from, 'nested'), { recursive: true })
      await realFsp.writeFile(path.join(from, 'nested', 'fresh.txt'), 'fresh')
      await realFsp.symlink('nested/fresh.txt', path.join(from, 'fresh-link'))
      await realFsp.mkdir(to, { recursive: true })
      await realFsp.writeFile(path.join(to, 'stale.txt'), 'stale')

      stubElectron(true)
      showMessageBoxSync.mockReturnValueOnce(1)
      stubBootConfig({ status: 'pending', from, to, copy: true })
      useRealFsAndFsp()
      stubDeps({ installPath: path.join(root, 'install') })
      const { runUserDataRelocationGate } = await loadGate()
      const result = await runUserDataRelocationGate()

      expect(result).toBe('handled')
      expect(await realFsp.readFile(path.join(to, 'nested', 'fresh.txt'), 'utf8')).toBe('fresh')
      await expect(realFsp.access(path.join(to, 'stale.txt'))).rejects.toThrow()
      expect((await realFsp.lstat(path.join(to, 'fresh-link'))).isSymbolicLink()).toBe(true)
      expect(await realFsp.readlink(path.join(to, 'fresh-link'))).toBe('nested/fresh.txt')
      expect(commitRelocation).toHaveBeenCalledWith(to)
    } finally {
      await realFsp.rm(root, { recursive: true, force: true })
    }
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

  it('copy failure removes only the temporary target tree before reporting failed', async () => {
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
    expect(rm).not.toHaveBeenCalledWith('/new/data', { recursive: true, force: true })
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/\.data\.relocation-/), { recursive: true, force: true })
    expect(rm).toHaveBeenCalledTimes(2)
  })

  it('copy failure restarts after cleanup when the relocation renderer was lost', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdir: vi.fn(async () => [fileEntry]),
      stat: vi.fn(async () => ({ size: 10 })),
      rm,
      copyFile: vi.fn(async () => {
        throw new Error('copy failed')
      })
    })
    stubDeps()
    wm.shouldRestartAfterTerminalFailure.mockReturnValue(true)

    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()

    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(rm).toHaveBeenCalledTimes(2)
    expect(rm).not.toHaveBeenCalledWith('/new/data', { recursive: true, force: true })
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: 'copy failed'
    })
    expect(wm.restartApp).toHaveBeenCalledTimes(1)
  })

  it('copy failure reports manual cleanup when temporary target removal also fails', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const rm = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('permission denied'))
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
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
    expect(rm).toHaveBeenCalledTimes(2)
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/manual cleanup required.*permission denied/i)
    })
    expect(wm.sendProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'failed', error: expect.stringMatching(/manual cleanup required/i) })
    )
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

  it('copy=true: rejects a source path that is a file before touching the target', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      statSync: vi.fn((p: string) => ({ dev: 1, isDirectory: () => p !== '/old' })),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/source exists and is not a directory/i)
    })
  })

  it('copy=true: rejects an unreadable source root before touching the target', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      accessSync: vi.fn((p: string, mode?: number) => {
        if (p === '/old' && mode === 4) {
          throw new Error('EACCES')
        }
      }),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/source directory is not readable.*EACCES/i)
    })
  })

  it('copy=true: rejects an unreadable nested source directory before touching the target', async () => {
    const nestedDir = {
      name: 'nested',
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false
    }
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdir: vi.fn(async (p: string) => {
        if (p === '/old') return [nestedDir]
        throw new Error('EACCES')
      }),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/source directory is not readable.*nested.*EACCES/i)
    })
  })

  it('copy=true: rejects a symlink target before touching the target', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({
      status: 'pending',
      from: '/old',
      to: '/new/data',
      copy: true
    })
    stubFsAndFsp({
      lstatSync: vi.fn((p: string) => ({ isSymbolicLink: () => p === '/new/data' })),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/target must not be a symlink/i)
    })
  })

  it('copy=true: rejects protected target descendants before touching the target', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/usr/local/cherry-data', copy: true })
    stubFsAndFsp({ rm })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/protected system path/i)
    })
  })

  it('copy=true: rejects target real path inside source real path when source has a symlinked ancestor', async () => {
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    const store = stubBootConfig({
      status: 'pending',
      from: '/links/userData',
      to: '/real/userData/nested-target',
      copy: true
    })
    stubFsAndFsp({
      realpathSync: vi.fn((p: string) => {
        if (p === '/links/userData') return '/real/userData'
        return p
      }),
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(rm).not.toHaveBeenCalled()
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/target real path is inside source real path/i)
    })
  })

  it('copy=true: restores the original target when final replacement rename fails', async () => {
    const fileEntry = {
      name: 'db.sqlite',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
    const rename = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rename failed'))
      .mockResolvedValueOnce(undefined)
    const rm = vi.fn(async () => undefined)
    stubElectron(true)
    showMessageBoxSync.mockReturnValueOnce(1)
    const store = stubBootConfig({ status: 'pending', from: '/old', to: '/new/data', copy: true })
    stubFsAndFsp({
      readdirSync: vi.fn((p: string) => (p === '/new/data' ? ['foreign-file'] : [])),
      readdir: vi.fn(async () => [fileEntry]),
      stat: vi.fn(async () => ({ size: 10 })),
      copyFile: vi.fn(async () => undefined),
      rename,
      rm
    })
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    expect(rename).toHaveBeenNthCalledWith(1, '/new/data', expect.stringMatching(/\.data\.relocation-backup-/))
    expect(rename).toHaveBeenNthCalledWith(2, expect.stringMatching(/\.data\.relocation-/), '/new/data')
    expect(rename).toHaveBeenNthCalledWith(3, expect.stringMatching(/\.data\.relocation-backup-/), '/new/data')
    expect(store['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: 'rename failed'
    })
  })
})
