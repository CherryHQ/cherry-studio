import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState } = vi.hoisted(() => ({
  platformState: { isLinux: false, isMac: false, isWin: false }
}))

let relocationState: Record<string, unknown>

vi.mock('@application', () => ({
  application: {
    getPath: (key: string, filename?: string) => {
      let root: unknown
      if (key === 'app.install') root = relocationState.installPath
      else if (key === 'cherry.home') root = relocationState.cherryHome
      else if (key in relocationState) root = relocationState[key]
      else root = path.join(String(relocationState.protectedRoot), key.replaceAll('.', '-'))
      return filename ? path.join(String(root), filename) : root
    }
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
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { get: vi.fn(() => null), set: vi.fn(), flush: vi.fn(), persist: vi.fn() }
}))

const roots: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-relocation-'))
  roots.push(root)
  return root
}

// The barrel is the domain's public surface; inspect resolves `from` from the
// mocked application.getPath('app.userdata') set per test in relocationState.
async function loadDomain() {
  return import('../index')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  platformState.isLinux = false
  platformState.isMac = false
  platformState.isWin = false

  relocationState = {
    installPath: makeRoot(),
    cherryHome: makeRoot(),
    protectedRoot: makeRoot(),
    'app.temp': makeRoot(),
    'app.userdata': null
  }
})

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('userDataRelocation validation', () => {
  it('rejects a missing target whose symlinked parent resolves inside the source', async () => {
    if (process.platform === 'win32') return
    const root = makeRoot()
    const source = path.join(root, 'source')
    const alias = path.join(root, 'alias')
    fs.mkdirSync(source)
    fs.symlinkSync(source, alias, 'dir')
    relocationState['app.userdata'] = source

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(path.join(alias, 'target'))).toEqual({
      valid: false,
      reason: 'target_inside_source'
    })
  })

  it('reports a non-absolute target with its own validation reason', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    relocationState['app.userdata'] = source

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget('relative/target')).toEqual({
      valid: false,
      reason: 'target_not_absolute'
    })
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
    relocationState['app.userdata'] = source
    platformState.isWin = true

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(usersRoot)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    expect(inspectUserDataRelocationTarget(appData)).toEqual({
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
    relocationState['app.userdata'] = source
    platformState.isMac = true

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(appData)).toEqual({
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
    relocationState['app.userdata'] = source
    platformState.isLinux = true

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(appData)).toEqual({
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
    relocationState['app.userdata'] = source

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(target)).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget(systemTemp)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('protects the relocation session root and its application-temp parent', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    const sessionRoot = path.join(String(relocationState['app.temp']), 'relocation-session')
    const appTempRoot = path.dirname(sessionRoot)
    fs.mkdirSync(source)
    relocationState['app.userdata'] = source

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(sessionRoot)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    expect(inspectUserDataRelocationTarget(appTempRoot)).toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('rejects source children, source parents, and protected application directories', async () => {
    const root = makeRoot()
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    relocationState['app.userdata'] = source

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget(path.join(source, 'child'))).toEqual({
      valid: false,
      reason: 'target_inside_source'
    })
    expect(inspectUserDataRelocationTarget(root)).toEqual({
      valid: false,
      reason: 'target_contains_source'
    })
    expect(inspectUserDataRelocationTarget(String(relocationState.cherryHome))).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    expect(inspectUserDataRelocationTarget(path.join(String(relocationState.protectedRoot), 'sys-temp'))).toEqual({
      valid: false,
      reason: 'target_protected'
    })
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
    relocationState['app.userdata'] = '/home/alice/cherry'

    const { inspectUserDataRelocationTarget } = await loadDomain()

    expect(inspectUserDataRelocationTarget('/var/cherry')).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: true
    })
    expect(inspectUserDataRelocationTarget('/var')).toEqual({
      valid: false,
      reason: 'target_protected'
    })
    entries.push('unrelated.txt')
    expect(inspectUserDataRelocationTarget('/var/cherry')).toEqual({
      valid: true,
      targetExists: true,
      targetEmpty: false
    })
  })
})
