import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/relocation/relocationGate.ts
 *
 * Covers the gate's decision logic (skip vs handled) and the success/failure
 * paths. The actual file-copy is exercised against a mocked fs that returns
 * an empty tree, so we validate the orchestration (pre-flight → copy →
 * commit → progress → clear) without touching real disk.
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

function stubFsAndFsp() {
  vi.doMock('node:fs', () => {
    const m = {
      existsSync: vi.fn(() => true),
      accessSync: vi.fn(() => undefined),
      constants: { W_OK: 2 }
    }
    return { ...m, default: m }
  })
  vi.doMock('node:fs/promises', () => ({
    __esModule: true,
    default: {
      readdir: vi.fn(async () => []),
      stat: vi.fn(async () => ({ size: 0 })),
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      symlink: vi.fn(async () => undefined),
      readlink: vi.fn(async () => '')
    }
  }))
}

function stubDeps() {
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
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runUserDataRelocationGate', () => {
  it('returns skipped in dev (unpackaged) even if a pending request exists', async () => {
    stubElectron(false)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new', copy: true })
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

  it('returns skipped when a previous relocation is in the failed state', async () => {
    stubElectron(true)
    stubBootConfig({
      status: 'failed',
      from: '/old',
      to: '/new',
      error: 'boom',
      failedAt: '2026-06-29T00:00:00.000Z'
    })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('skipped')
    expect(wm.create).not.toHaveBeenCalled()
  })

  it('pending + copy=false: commits the new path and reports completed (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new', copy: false })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.create).toHaveBeenCalled()
    // No copy → no copying stage emitted; jump straight to committing/completed.
    expect(commitRelocation).toHaveBeenCalledWith('/new')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('pending + copy=true: runs the copy then commits (handled)', async () => {
    stubElectron(true)
    stubBootConfig({ status: 'pending', from: '/old', to: '/new', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'copying' }))
    expect(commitRelocation).toHaveBeenCalledWith('/new')
    expect(wm.sendProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'completed' }))
  })

  it('preflight failure (from === to): clears temp, reports failed, no commit (handled)', async () => {
    stubElectron(true)
    const store = stubBootConfig({ status: 'pending', from: '/same', to: '/same', copy: true })
    stubFsAndFsp()
    stubDeps()
    const { runUserDataRelocationGate } = await loadGate()
    const result = await runUserDataRelocationGate()
    expect(result).toBe('handled')
    expect(commitRelocation).not.toHaveBeenCalled()
    // Gate clears the request so the next launch doesn't loop on the same failure.
    expect(store['temp.user_data_relocation']).toBeNull()
    expect(wm.sendProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'failed', error: expect.stringMatching(/same path/i) })
    )
  })
})
