import fs from 'node:fs'
import type { cp, statfs, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appSetPathMock,
  bootConfigFlushMock,
  bootConfigGetMock,
  bootConfigPersistMock,
  bootConfigSetMock,
  electronState,
  platformState,
  relaunchMock,
  updateProgressMock,
  windowCloseMock,
  windowHasWindowMock,
  windowIsUnavailableMock,
  windowOpenMock
} = vi.hoisted(() => ({
  appSetPathMock: vi.fn(),
  bootConfigFlushMock: vi.fn(),
  bootConfigGetMock: vi.fn(),
  bootConfigPersistMock: vi.fn(),
  bootConfigSetMock: vi.fn(),
  electronState: { isPackaged: true },
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
    getPath: (key: string, filename?: string) => {
      let root: unknown
      if (key === 'app.install') root = relocationState.installPath
      else if (key === 'cherry.home') root = relocationState.cherryHome
      else if (key in relocationState) root = relocationState[key]
      else root = path.join(String(relocationState.protectedRoot), key.replaceAll('.', '-'))
      return filename ? path.join(String(root), filename) : root
    },
    relaunch: relaunchMock
  }
}))
vi.mock('@main/core/platform', () => ({
  isDev: false,
  isPortable: false,
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
// userDataLocation is intentionally NOT mocked: the private commit step runs
// for real, so these flow tests cover the BootConfig commit transaction too.
// getNormalizedExecutablePath() resolves to app.getPath('exe') = '/mock/exe'.
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: bootConfigGetMock,
    set: bootConfigSetMock,
    flush: bootConfigFlushMock,
    persist: bootConfigPersistMock
  }
}))
vi.mock('../window', () => ({
  openUserDataRelocationWindow: windowOpenMock
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged
    },
    getPath: vi.fn((key: string) => (key === 'exe' ? '/mock/exe' : '/mock/unknown')),
    setPath: appSetPathMock,
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

function expectCommitted(target: string, previousMapping: Record<string, string> = {}) {
  expect(relocationState['app.user_data_path']).toEqual({ ...previousMapping, '/mock/exe': target })
  expect(relocationState['temp.user_data_relocation']).toBeNull()
  expect(bootConfigPersistMock).toHaveBeenCalledTimes(1)
}

function expectNotCommitted() {
  // persist() is only ever called by the commit step; failure paths use flush().
  expect(bootConfigPersistMock).not.toHaveBeenCalled()
}

type FsPromisesOverrides = Partial<{ cp: typeof cp; statfs: typeof statfs; symlink: typeof symlink }>

async function usePromises(overrides: FsPromisesOverrides = {}) {
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('node:fs/promises')
    const merged = { ...actual, ...overrides }
    return { ...merged, default: merged }
  })
}

async function loadDomain() {
  return import('../index')
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  electronState.isPackaged = true
  platformState.isLinux = false
  platformState.isMac = false
  platformState.isWin = false
  await usePromises()

  const appTemp = makeRoot()
  relocationState = {
    installPath: makeRoot(),
    cherryHome: makeRoot(),
    protectedRoot: makeRoot(),
    'app.temp': appTemp,
    'app.userdata': null,
    'temp.user_data_relocation': null
  }
  bootConfigGetMock.mockImplementation((key: string) => relocationState[key])
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    relocationState[key] = value
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

describe('userDataRelocation execution', () => {
  it('prepares a fresh temporary sessionData directory for a pending copy', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()

    await expect(runUserDataRelocation()).resolves.toBe('handled')
    const sessionDataPath = appSetPathMock.mock.calls[0]?.[1]
    expect(sessionDataPath).toEqual(expect.any(String))
    expect(
      String(sessionDataPath).startsWith(
        path.join(String(relocationState['app.temp']), 'relocation-session', `${TASK_ID}-`)
      )
    ).toBe(true)
    expect(fs.statSync(String(sessionDataPath)).isDirectory()).toBe(true)
  })

  it('clears a stale request whose source is not the currently resolved userData', async () => {
    const root = makeRoot()
    const current = path.join(root, 'current')
    const stale = path.join(root, 'stale')
    const target = path.join(root, 'target')
    fs.mkdirSync(current)
    fs.mkdirSync(stale)
    relocationState['app.userdata'] = current
    relocationState['temp.user_data_relocation'] = pending(stale, target)

    const { runUserDataRelocation } = await loadDomain()

    await expect(runUserDataRelocation()).resolves.toBe('skipped')
    expect(relocationState['temp.user_data_relocation']).toBeNull()
    expect(appSetPathMock).not.toHaveBeenCalled()
    expect(windowOpenMock).not.toHaveBeenCalled()
  })

  it('skips unpackaged development runs before even reading BootConfig', async () => {
    electronState.isPackaged = false
    relocationState['temp.user_data_relocation'] = pending('/old/data', '/new/data')

    const { runUserDataRelocation } = await loadDomain()

    await expect(runUserDataRelocation()).resolves.toBe('skipped')
    expect(bootConfigGetMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(bootConfigFlushMock).not.toHaveBeenCalled()
    expect(appSetPathMock).not.toHaveBeenCalled()
    expect(windowOpenMock).not.toHaveBeenCalled()
  })

  it('skips a launch with no relocation state without clearing anything', async () => {
    const { runUserDataRelocation } = await loadDomain()

    await expect(runUserDataRelocation()).resolves.toBe('skipped')
    expect(bootConfigSetMock).not.toHaveBeenCalled()
    expect(bootConfigFlushMock).not.toHaveBeenCalled()
    expect(appSetPathMock).not.toHaveBeenCalled()
    expect(windowOpenMock).not.toHaveBeenCalled()
  })

  it('validates relocation paths before cleaning recovery artifacts', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(source, 'target')
    const workPath = path.join(source, `.target.cherry-relocation-${TASK_ID}-work`)
    fs.mkdirSync(source)
    fs.mkdirSync(workPath)
    fs.writeFileSync(path.join(workPath, 'partial.txt'), 'keep')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(workPath, 'partial.txt'), 'utf8')).toBe('keep')
    expectNotCommitted()
  })

  it('refuses an existing target that carries an active Chromium singleton marker', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'new.txt'), 'new')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'SingletonLock'), 'owned')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target, true)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'SingletonLock'), 'utf8')).toBe('owned')
    expectNotCommitted()
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'old.txt'), 'utf8')).toBe('old')
    expect(fs.readFileSync(path.join(target, 'old-folder', 'nested.txt'), 'utf8')).toBe('nested')
    expect(fs.existsSync(path.join(target, 'new.txt'))).toBe(false)
    expectNotCommitted()
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(path.join(target, 'SingletonLock'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'SingletonSocket'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'SingletonCookie'))).toBe(false)
    expectCommitted(target)
  })

  it('rewrites an absolute symlink that points inside the copied source tree', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    fs.symlinkSync(path.join(source, 'data.txt'), path.join(source, 'data-link'))
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readlinkSync(path.join(target, 'data-link'))).toBe(path.join(fs.realpathSync(target), 'data.txt'))
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('resolves a relative directory link before creating a Windows junction', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(path.join(source, 'real'), { recursive: true })
    fs.symlinkSync('real', path.join(source, 'relative-link'), 'dir')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)
    platformState.isWin = true
    const symlinkMock = vi.fn<typeof symlink>().mockImplementation(async (targetValue, linkPath) => {
      fs.symlinkSync(targetValue, linkPath)
    })
    await usePromises({ symlink: symlinkMock })

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(symlinkMock).toHaveBeenCalledWith(
      path.join(fs.realpathSync(target), 'real'),
      path.join(root, `.target.cherry-relocation-${TASK_ID}-work`, 'payload', 'relative-link'),
      'junction'
    )
    expectCommitted(target)
  })

  it('tolerates a source file that vanishes between enumeration and copy', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'volatile.txt'), 'cache')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      cp: vi.fn<typeof cp>().mockImplementation(async (_source, destination, options) => {
        const sourcePath = path.join(source, 'volatile.txt')
        fs.mkdirSync(String(destination), { recursive: true })
        fs.rmSync(sourcePath)
        const shouldCopy = await options?.filter?.(sourcePath, path.join(String(destination), 'volatile.txt'))
        expect(shouldCopy).toBe(false)
      })
    })
    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expectCommitted(target)
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('requires a 20 percent free-space margin before moving or creating the target', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({ statfs: vi.fn().mockResolvedValue({ bsize: 1, bavail: 4, blocks: 10 }) })
    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.existsSync(target)).toBe(false)
    expectNotCommitted()
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = {
      status: 'failed',
      taskId: TASK_ID,
      from: source,
      to: target,
      copy: true,
      error: 'copy failed',
      failedAt: '2026-07-13T00:00:00.000Z'
    }

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(appSetPathMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({ status: 'failed' })
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'failed', error: 'copy failed' }))

    restartFromWindow?.()
    expect(relocationState['temp.user_data_relocation']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalledTimes(1)
    expect(relaunchMock).toHaveBeenCalledTimes(1)
  })

  it('fails the relocation instead of crashing when the temporary sessionData cannot be prepared', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    const blockedTemp = path.join(root, 'blocked-temp')
    fs.writeFileSync(blockedTemp, 'not a directory')
    relocationState['app.temp'] = blockedTemp
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()

    await expect(runUserDataRelocation()).resolves.toBe('handled')
    expect(appSetPathMock).not.toHaveBeenCalled()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({
      status: 'failed',
      taskId: TASK_ID,
      error: expect.stringContaining('failed to prepare isolated sessionData')
    })
    expect(updateProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'failed',
        error: expect.stringContaining('failed to prepare isolated sessionData')
      })
    )
    expect(fs.existsSync(target)).toBe(false)
  })

  it('copies successfully into a new target and merges the executable mapping', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)
    // Pre-existing mapping for another executable must survive the commit.
    relocationState['app.user_data_path'] = { '/other/exe': '/other/data' }

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(path.join(target, '.cherry-relocation-owner.json'))).toBe(false)
    expectCommitted(target, { '/other/exe': '/other/data' })
  })

  it('publishes file-granularity copy progress clamped to the scanned total', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'a.bin'), Buffer.alloc(60))
    fs.writeFileSync(path.join(source, 'b.bin'), Buffer.alloc(40))
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    const copying = updateProgressMock.mock.calls
      .map((call) => call[0] as { stage: string; bytesCopied: number; bytesTotal: number })
      .filter((progress) => progress.stage === 'copying')
    // Initial 0, one publish per file (each crosses an integer percent), and
    // the unconditional (total, total) publish after fsp.cp returns.
    expect(copying[0]).toMatchObject({ bytesCopied: 0, bytesTotal: 100 })
    expect(copying.at(-1)).toMatchObject({ bytesCopied: 100, bytesTotal: 100 })
    expect(copying.length).toBeGreaterThanOrEqual(3)
    const series = copying.map((progress) => progress.bytesCopied)
    expect(series).toEqual([...series].sort((a, b) => a - b))
    for (const progress of copying) {
      expect(progress.bytesCopied).toBeLessThanOrEqual(progress.bytesTotal)
    }
    expectCommitted(target)
  })

  it('switches to any existing non-empty directory without modifying its files', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'arbitrary-document.xlsx'), 'existing file')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target, false)

    const { inspectUserDataRelocationTarget, runUserDataRelocation } = await loadDomain()

    expect(inspectUserDataRelocationTarget(target)).toEqual({
      valid: true,
      targetEmpty: false
    })
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'arbitrary-document.xlsx'), 'utf8')).toBe('existing file')
    expect(fs.readdirSync(target)).toEqual(['arbitrary-document.xlsx'])
    // A switch never reads the source tree, so it must not depend on the temp
    // filesystem through sessionData isolation.
    expect(appSetPathMock).not.toHaveBeenCalled()
    expectCommitted(target)
  })

  it('preserves a target populated while the source is being scanned', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      statfs: vi.fn().mockImplementation(async () => {
        fs.writeFileSync(path.join(target, 'arrived-during-scan.txt'), 'keep')
        return { bsize: 1, bavail: 1_000_000, blocks: 1_000_000 }
      })
    })
    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'arrived-during-scan.txt'), 'utf8')).toBe('keep')
    expect(fs.existsSync(path.join(target, 'data.txt'))).toBe(false)
    expectNotCommitted()
  })

  it('restores an empty claimed target when a locked source file aborts the copy', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'locked.db'), 'data')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    await usePromises({
      cp: vi.fn<typeof cp>().mockRejectedValue(Object.assign(new Error('file is locked'), { code: 'EACCES' }))
    })
    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readdirSync(target)).toEqual([])
    expectNotCommitted()
    expect(relocationState['temp.user_data_relocation']).toMatchObject({ status: 'failed', taskId: TASK_ID })
  })

  it('rolls back the promoted target and the in-memory mapping when the BootConfig commit cannot persist', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'data.txt'), 'data')
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)
    relocationState['app.user_data_path'] = { '/other/exe': '/other/data' }
    bootConfigPersistMock.mockImplementationOnce(() => {
      throw new Error('boot config disk full')
    })

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(source, 'data.txt'), 'utf8')).toBe('data')
    expect(fs.existsSync(target)).toBe(false)
    // The in-memory compensation restored the mapping the failed persist had staged.
    expect(relocationState['app.user_data_path']).toEqual({ '/other/exe': '/other/data' })
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.existsSync(work)).toBe(false)
    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('data')
    expectCommitted(target)
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.existsSync(path.join(target, 'stale-promoted.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(target, 'data.txt'), 'utf8')).toBe('fresh')
    expect(fs.existsSync(aside)).toBe(false)
    expectCommitted(target)
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
    relocationState['app.userdata'] = source
    relocationState['temp.user_data_relocation'] = pending(source, target)

    const { runUserDataRelocation } = await loadDomain()
    await expect(runUserDataRelocation()).resolves.toBe('handled')

    expect(fs.readFileSync(path.join(target, 'new-after-crash.txt'), 'utf8')).toBe('preserve')
    expect(fs.existsSync(aside)).toBe(true)
    expectNotCommitted()
  })
})
