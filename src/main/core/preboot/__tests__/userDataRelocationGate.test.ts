import fs from 'node:fs'
import type { copyFile, statfs, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetPathMock,
  bootConfigPersistMock,
  bootConfigGetMock,
  bootConfigSetMock,
  commitMock,
  platformState,
  relaunchMock,
  updateProgressMock,
  windowCloseMock,
  windowHasWindowMock,
  windowIsUnavailableMock,
  windowOpenMock
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  bootConfigPersistMock: vi.fn(),
  bootConfigGetMock: vi.fn(),
  bootConfigSetMock: vi.fn(),
  commitMock: vi.fn(),
  platformState: { isWin: false },
  relaunchMock: vi.fn(),
  updateProgressMock: vi.fn(),
  windowCloseMock: vi.fn(),
  windowHasWindowMock: vi.fn(() => true),
  windowIsUnavailableMock: vi.fn(() => false),
  windowOpenMock: vi.fn()
}))

let relocationState: Record<string, unknown>
let restartFromWindow: (() => void) | undefined

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => (key === 'app.install' ? relocationState.installPath : '/mock/path'),
    relaunch: relaunchMock
  }
}))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platformState.isWin
  }
}))
vi.mock('@main/core/preboot/userDataLocation', () => ({ commitUserDataRelocation: commitMock }))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: bootConfigGetMock,
    set: bootConfigSetMock,
    persist: bootConfigPersistMock
  }
}))
vi.mock('@main/services/relocationWindowService', () => ({
  openUserDataRelocationWindow: windowOpenMock
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: appGetPathMock,
    whenReady: vi.fn().mockResolvedValue(undefined)
  }
}))

const roots: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-relocation-'))
  roots.push(root)
  return root
}

function pending(from: string, to: string, overwrite = false) {
  return { status: 'pending' as const, from, to, copy: true, overwrite }
}

type FsPromisesOverrides = Partial<{ copyFile: typeof copyFile; statfs: typeof statfs; symlink: typeof symlink }>

async function usePromises(overrides: FsPromisesOverrides = {}) {
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('node:fs/promises')
    const merged = { ...actual, ...overrides }
    return { ...merged, default: merged }
  })
}

async function loadGate() {
  return import('../userDataRelocationGate')
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  platformState.isWin = false
  await usePromises()

  relocationState = { installPath: makeRoot(), 'temp.user_data_relocation': null }
  bootConfigGetMock.mockImplementation((key: string) => relocationState[key])
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    relocationState[key] = value
  })
  commitMock.mockImplementation(() => {
    relocationState['temp.user_data_relocation'] = null
  })
  windowHasWindowMock.mockReturnValue(true)
  windowIsUnavailableMock.mockReturnValue(false)
  windowOpenMock.mockImplementation((options: { onRestart(): void }) => {
    restartFromWindow = options.onRestart
    return {
      waitForReady: () => Promise.resolve(),
      updateProgress: updateProgressMock,
      hasWindow: windowHasWindowMock,
      isUnavailable: windowIsUnavailableMock,
      close: windowCloseMock
    }
  })
})

afterEach(() => {
  restartFromWindow = undefined
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('userDataRelocationGate', () => {
  it('clears a stale request whose source is not the currently resolved userData', async () => {
    const root = makeRoot()
    const current = path.join(root, 'current')
    const stale = path.join(root, 'stale')
    const target = path.join(root, 'target')
    fs.mkdirSync(current)
    fs.mkdirSync(stale)
    appGetPathMock.mockReturnValue(current)
    relocationState['temp.user_data_relocation'] = pending(stale, target)

    const { runUserDataRelocationGate } = await loadGate()

    await expect(runUserDataRelocationGate()).resolves.toBe('skipped')
    expect(relocationState['temp.user_data_relocation']).toBeNull()
    expect(windowOpenMock).not.toHaveBeenCalled()
  })

  it('rejects a missing target whose symlinked parent resolves inside the source', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const source = path.join(root, 'source')
    const alias = path.join(root, 'alias')
    fs.mkdirSync(source)
    fs.symlinkSync(source, alias, 'dir')

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, path.join(alias, 'target'))).toEqual({
      valid: false,
      reason: 'target_inside_source'
    })
  })

  it('reports a non-absolute target with its own validation reason', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    fs.mkdirSync(source)

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, 'relative/target')).toEqual({
      valid: false,
      reason: 'target_not_absolute'
    })
  })

  it('validates relocation paths before cleaning recovery artifacts', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(source, 'target')
    const workPath = path.join(source, '.target.cherry-relocation-work')
    fs.mkdirSync(source)
    fs.mkdirSync(workPath)
    fs.writeFileSync(path.join(workPath, 'partial.txt'), 'keep')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(workPath, 'partial.txt'), 'utf8')).toBe('keep')
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('refuses an existing target that carries an active Chromium singleton marker', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'new.txt'), 'new')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'SingletonLock'), 'owned')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target, true)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'SingletonLock'), 'utf8')).toBe('owned')
    expect(commitMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      copy: true,
      overwrite: true
    })
  })

  it('restores an overwritten target when the staged copy fails', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'new.txt'), 'new')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'old.txt'), 'old')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target, true)

    await usePromises({
      copyFile: vi.fn().mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'old.txt'), 'utf8')).toBe('old')
    expect(fs.existsSync(path.join(target, 'new.txt'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.target.cherry-relocation-work'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.target.cherry-relocation-aside'))).toBe(false)
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('excludes active Singleton markers when copying the userData root', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    fs.writeFileSync(path.join(source, 'SingletonLock'), 'lock')
    fs.writeFileSync(path.join(source, 'SingletonSocket'), 'socket')
    fs.writeFileSync(path.join(source, 'SingletonCookie'), 'cookie')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(path.join(target, 'SingletonLock'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'SingletonSocket'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'SingletonCookie'))).toBe(false)
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('rewrites an absolute symlink that points inside the copied source tree', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    fs.symlinkSync(path.join(source, 'data.txt'), path.join(source, 'data-link'))
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readlinkSync(path.join(target, 'data-link'))).toBe(path.join(fs.realpathSync(target), 'data.txt'))
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('resolves a relative directory link before creating a Windows junction', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(path.join(source, 'real'), { recursive: true })
    fs.symlinkSync('real', path.join(source, 'relative-link'), 'dir')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)
    platformState.isWin = true
    const symlinkMock = vi.fn<typeof symlink>().mockResolvedValue(undefined)
    await usePromises({ symlink: symlinkMock })

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(symlinkMock).toHaveBeenCalledWith(
      path.join(fs.realpathSync(target), 'real'),
      path.join(root, '.target.cherry-relocation-work', 'relative-link'),
      'junction'
    )
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('tolerates a source file that vanishes between enumeration and copy', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'volatile.txt'), 'cache')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      copyFile: vi.fn().mockRejectedValue(Object.assign(new Error('vanished'), { code: 'ENOENT' }))
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(commitMock).toHaveBeenCalledWith(target)
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('fails the free-space precheck before moving or creating the target', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({ statfs: vi.fn().mockResolvedValue({ bsize: 1, bavail: 0, blocks: 1 }) })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.existsSync(target)).toBe(false)
    expect(commitMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('not enough free space')
    })
    expect(bootConfigPersistMock).toHaveBeenCalledTimes(1)
  })

  it('keeps failed state until the recovery window explicitly continues on the old path', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = {
      status: 'failed',
      from: source,
      to: target,
      copy: true,
      overwrite: false,
      error: 'copy failed',
      failedAt: '2026-07-13T00:00:00.000Z'
    }

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(relocationState['temp.user_data_relocation']).toMatchObject({ status: 'failed' })
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'failed', error: 'copy failed' }))

    restartFromWindow?.()
    expect(relocationState['temp.user_data_relocation']).toBeNull()
    expect(bootConfigPersistMock).toHaveBeenCalledTimes(1)
    expect(relaunchMock).toHaveBeenCalledTimes(1)
  })

  it('allows an empty first-level target but rejects it once non-empty', async () => {
    vi.resetModules()
    const entries: string[] = []
    const existing = new Set(['/home/alice/cherry', '/data', '/', String(relocationState.installPath)])
    const realpathSync = vi.fn((value: string) => value)
    ;(realpathSync as typeof realpathSync & { native?: typeof realpathSync }).native = realpathSync
    vi.doMock('node:fs', () => {
      const mock = {
        constants: { R_OK: 4, W_OK: 2, X_OK: 1 },
        accessSync: vi.fn(),
        lstatSync: vi.fn((value: string) => {
          if (existing.has(value)) return { isDirectory: () => true }
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }),
        statSync: vi.fn(() => ({ isDirectory: () => true })),
        readdirSync: vi.fn((value: string) => (value === '/data' ? entries : [])),
        realpathSync
      }
      return { ...mock, default: mock }
    })

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget('/home/alice/cherry', '/data')).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    entries.push('unrelated.txt')
    expect(inspectUserDataRelocationTarget('/home/alice/cherry', '/data')).toEqual({
      valid: false,
      reason: 'target_top_level_not_empty'
    })
  })
})
