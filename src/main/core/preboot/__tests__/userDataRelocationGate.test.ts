import fs from 'node:fs'
import type { copyFile, statfs, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetPathMock,
  bootConfigFlushMock,
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
  bootConfigFlushMock: vi.fn(),
  bootConfigGetMock: vi.fn(),
  bootConfigSetMock: vi.fn(),
  commitMock: vi.fn(),
  platformState: { isLinux: false, isMac: false, isWin: false },
  relaunchMock: vi.fn(),
  updateProgressMock: vi.fn(),
  windowCloseMock: vi.fn(),
  windowHasWindowMock: vi.fn(() => true),
  windowIsUnavailableMock: vi.fn(() => false),
  windowOpenMock: vi.fn()
}))

let relocationState: Record<string, unknown>
let restartFromWindow: (() => void) | undefined
const TASK_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      if (key === 'app.install') return relocationState.installPath
      if (key === 'cherry.home') return relocationState.cherryHome
      if (key in relocationState) return relocationState[key]
      return path.join(String(relocationState.protectedRoot), key.replaceAll('.', '-'))
    },
    relaunch: relaunchMock
  }
}))
vi.mock('@main/core/platform', () => ({
  get isLinux() {
    return platformState.isLinux
  },
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  }
}))
vi.mock('@main/core/preboot/userDataLocation', () => ({ commitUserDataRelocation: commitMock }))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: bootConfigGetMock,
    set: bootConfigSetMock,
    flush: bootConfigFlushMock,
    persist: vi.fn()
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

function pending(from: string, to: string, copy = true, taskId = TASK_ID) {
  return { status: 'pending' as const, taskId, from, to, copy }
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
  platformState.isLinux = false
  platformState.isMac = false
  platformState.isWin = false
  await usePromises()

  relocationState = {
    installPath: makeRoot(),
    cherryHome: makeRoot(),
    protectedRoot: makeRoot(),
    'temp.user_data_relocation': null
  }
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
    const workPath = path.join(source, `.target.cherry-relocation-${TASK_ID}-work`)
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
      copy: true
    })
  })

  it('refuses to copy into an unknown non-empty target and preserves every existing file', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'new.txt'), 'new')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'old.txt'), 'old')
    fs.mkdirSync(path.join(target, 'old-folder'))
    fs.writeFileSync(path.join(target, 'old-folder', 'nested.txt'), 'nested')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'old.txt'), 'utf8')).toBe('old')
    expect(fs.readFileSync(path.join(target, 'old-folder', 'nested.txt'), 'utf8')).toBe('nested')
    expect(fs.existsSync(path.join(target, 'new.txt'))).toBe(false)
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
    const symlinkMock = vi.fn<typeof symlink>().mockImplementation(async (targetValue, linkPath) => {
      fs.symlinkSync(targetValue, linkPath)
    })
    await usePromises({ symlink: symlinkMock })

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(symlinkMock).toHaveBeenCalledWith(
      path.join(fs.realpathSync(target), 'real'),
      path.join(root, `.target.cherry-relocation-${TASK_ID}-work`, 'relative-link'),
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
      copyFile: vi.fn().mockImplementation(async (sourcePath) => {
        fs.rmSync(sourcePath)
        throw Object.assign(new Error('vanished'), { code: 'ENOENT' })
      })
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(commitMock).toHaveBeenCalledWith(target)
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('requires a 20 percent free-space margin before moving or creating the target', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({ statfs: vi.fn().mockResolvedValue({ bsize: 1, bavail: 4, blocks: 10 }) })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.existsSync(target)).toBe(false)
    expect(commitMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('not enough free space')
    })
    expect(bootConfigFlushMock).toHaveBeenCalledTimes(1)
  })

  it('keeps failed state until the recovery window explicitly continues on the old path', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = {
      status: 'failed',
      taskId: TASK_ID,
      from: source,
      to: target,
      copy: true,
      error: 'copy failed',
      failedAt: '2026-07-13T00:00:00.000Z'
    }

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(relocationState['temp.user_data_relocation']).toMatchObject({ status: 'failed' })
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'failed', error: 'copy failed' }))

    restartFromWindow?.()
    expect(relocationState['temp.user_data_relocation']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalledTimes(1)
    expect(relaunchMock).toHaveBeenCalledTimes(1)
  })

  it('copies successfully into a new target', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(path.join(target, '.cherry-relocation-owner.json'))).toBe(false)
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('switches to any existing non-empty directory without modifying its files', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'arbitrary-document.xlsx'), 'existing file')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target, false)

    const { inspectUserDataRelocationTarget, runUserDataRelocationGate } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: false
    })
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'arbitrary-document.xlsx'), 'utf8')).toBe('existing file')
    expect(fs.readdirSync(target)).toEqual(['arbitrary-document.xlsx'])
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('allows an app-specific directory below Windows AppData while protecting the Users and AppData roots', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const usersRoot = path.join(root, 'Users')
    const systemHome = path.join(usersRoot, 'alice')
    const appData = path.join(systemHome, 'AppData', 'Roaming')
    const target = path.join(appData, 'Cherry Studio')
    fs.mkdirSync(source)
    fs.mkdirSync(target, { recursive: true })
    fs.mkdirSync(appData, { recursive: true })
    relocationState['sys.home'] = systemHome
    relocationState['sys.appdata'] = appData
    platformState.isWin = true

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(source, usersRoot)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    expect(inspectUserDataRelocationTarget(source, appData)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('allows an app-specific directory below macOS Application Support while protecting the root', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const systemHome = path.join(root, 'Users', 'alice')
    const appData = path.join(systemHome, 'Library', 'Application Support')
    const target = path.join(appData, 'Cherry Studio')
    fs.mkdirSync(source)
    fs.mkdirSync(target, { recursive: true })
    relocationState['sys.home'] = systemHome
    relocationState['sys.appdata'] = appData
    platformState.isMac = true

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(source, appData)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('allows an app-specific directory below the Linux config root while protecting the root', async () => {
    const root = fs.mkdtempSync(path.join('/tmp', 'cherry-relocation-linux-'))
    roots.push(root)
    const source = path.join(root, 'source')
    const systemHome = path.join(root, 'home', 'alice')
    const appData = path.join(systemHome, '.config')
    const target = path.join(appData, 'Cherry Studio')
    fs.mkdirSync(source)
    fs.mkdirSync(target, { recursive: true })
    relocationState['sys.home'] = systemHome
    relocationState['sys.appdata'] = appData
    platformState.isLinux = true

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(source, appData)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('allows an app-specific directory below the system temp root while protecting the root', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const systemTemp = path.join(root, 'temp')
    const target = path.join(systemTemp, 'Cherry Studio')
    fs.mkdirSync(source)
    fs.mkdirSync(target, { recursive: true })
    relocationState['sys.temp'] = systemTemp

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(source, systemTemp)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('rejects source children, source parents, and protected application directories', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    fs.mkdirSync(source)

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget(source, path.join(source, 'child'))).toEqual({
      valid: false,
      reason: 'target_inside_source'
    })
    expect(inspectUserDataRelocationTarget(source, root)).toEqual({
      valid: false,
      reason: 'target_contains_source'
    })
    expect(inspectUserDataRelocationTarget(source, String(relocationState.cherryHome))).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    expect(
      inspectUserDataRelocationTarget(source, path.join(String(relocationState.protectedRoot), 'sys-temp'))
    ).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('preserves a target populated while the source is being scanned', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      statfs: vi.fn().mockImplementation(async () => {
        fs.writeFileSync(path.join(target, 'arrived-during-scan.txt'), 'keep')
        return { bsize: 1, bavail: 1_000_000, blocks: 1_000_000 }
      })
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'arrived-during-scan.txt'), 'utf8')).toBe('keep')
    expect(fs.existsSync(path.join(target, 'data.txt'))).toBe(false)
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('restores an empty claimed target when a locked source file aborts the copy', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'locked.db'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      copyFile: vi.fn().mockRejectedValue(Object.assign(new Error('file is locked'), { code: 'EACCES' }))
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readdirSync(target)).toEqual([])
    expect(commitMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({ status: 'failed', taskId: TASK_ID })
  })

  it('rolls back when copied data fails the integrity verification', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'complete-data')
    fs.mkdirSync(target)
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      copyFile: vi.fn().mockImplementation(async (_sourcePath, targetPath) => {
        fs.writeFileSync(targetPath, 'truncated')
      })
    })
    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(source, 'data.txt'), 'utf8')).toBe('complete-data')
    expect(fs.readdirSync(target)).toEqual([])
    expect(commitMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('verification failed')
    })
  })

  it('removes only the owned promoted target when BootConfig commit fails', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)
    commitMock.mockImplementationOnce(() => {
      throw new Error('boot config disk full')
    })

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(source, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(target)).toBe(false)
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      error: 'boot config disk full'
    })
  })

  it('resumes after a power loss by deleting a matching owned work tree only', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    const work = path.join(root, `.target.cherry-relocation-${TASK_ID}-work`)
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    fs.mkdirSync(work)
    fs.writeFileSync(
      path.join(work, '.cherry-relocation-owner.json'),
      JSON.stringify({ kind: 'cherry-studio-user-data-relocation', taskId: TASK_ID })
    )
    fs.writeFileSync(path.join(work, 'partial.txt'), 'partial')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.existsSync(work)).toBe(false)
    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('recovers a power loss after promotion by removing only the owned promoted target', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    const aside = path.join(root, `.target.cherry-relocation-${TASK_ID}-aside`)
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'fresh')
    fs.mkdirSync(target)
    fs.writeFileSync(
      path.join(target, '.cherry-relocation-owner.json'),
      JSON.stringify({ kind: 'cherry-studio-user-data-relocation', taskId: TASK_ID })
    )
    fs.writeFileSync(path.join(target, 'stale-promoted.txt'), 'stale')
    fs.mkdirSync(aside)
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.existsSync(path.join(target, 'stale-promoted.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('fresh')
    expect(fs.existsSync(aside)).toBe(false)
    expect(commitMock).toHaveBeenCalledWith(target)
  })

  it('never deletes an unowned target found beside an interrupted aside', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    const aside = path.join(root, `.target.cherry-relocation-${TASK_ID}-aside`)
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.mkdirSync(aside)
    fs.writeFileSync(path.join(target, 'existing.txt'), 'existing')
    fs.writeFileSync(path.join(target, 'new-after-crash.txt'), 'preserve')
    appGetPathMock.mockReturnValue(source)
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocationGate } = await loadGate()
    await expect(runUserDataRelocationGate()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'new-after-crash.txt'), 'utf8')).toBe('preserve')
    expect(fs.existsSync(aside)).toBe(true)
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('allows writable descendants of protected Linux top-level directories but not the directories themselves', async () => {
    vi.resetModules()
    const entries: string[] = []
    const existing = new Set(['/home/alice/cherry', '/var', '/var/cherry', '/', String(relocationState.installPath)])
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
        statSync: vi.fn((value: string) => {
          if (existing.has(value)) return { isDirectory: () => true, isFile: () => false, size: 0 }
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }),
        readdirSync: vi.fn((value: string) => (value === '/var/cherry' ? entries : [])),
        readFileSync: vi.fn(() => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }),
        realpathSync
      }
      return { ...mock, default: mock }
    })
    platformState.isLinux = true

    const { inspectUserDataRelocationTarget } = await loadGate()

    expect(inspectUserDataRelocationTarget('/home/alice/cherry', '/var/cherry')).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget('/home/alice/cherry', '/var')).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    entries.push('unrelated.txt')
    expect(inspectUserDataRelocationTarget('/home/alice/cherry', '/var/cherry')).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: false
    })
  })
})
