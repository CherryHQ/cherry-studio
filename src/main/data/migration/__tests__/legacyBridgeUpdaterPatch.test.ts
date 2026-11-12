import { spawn as spawnProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

import type { CustomPublishOptions } from 'builder-util-runtime'
import type { MacUpdater } from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { expect, it, vi } from 'vitest'

// Exercise the installed dependency patch, replacing only Electron's native boundary.
function fixture() {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('electron-updater/out/MacUpdater.js')
  const localRequire = createRequire(entry)
  const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(), quitAndInstall: vi.fn() })
  const exports: { MacUpdater?: typeof MacUpdater } = {}
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    exports,
    require: (name: string) => (name === 'electron' ? { autoUpdater: native } : localRequire(name)),
    Buffer,
    process,
    URL
  })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-updater-'))
  const adapter: AppAdapter = {
    version: '2.2.0',
    name: 'test',
    isPackaged: true,
    appUpdateConfigPath: path.join(root, 'app-update.yml'),
    userDataPath: root,
    baseCachePath: root,
    whenReady: async () => {},
    quit: vi.fn(),
    relaunch: vi.fn(),
    onQuit: vi.fn()
  }
  return { native, root, adapter, Updater: exports.MacUpdater! }
}

it('removes only its own native listeners and never installs after disposal', () => {
  const f = fixture()
  const unrelated = vi.fn()
  f.native.on('update-downloaded', unrelated)
  const updater = new f.Updater(undefined, f.adapter)
  updater.logger = null
  updater.autoInstallOnAppQuit = false
  updater.quitAndInstall()
  updater.quitAndInstall()
  expect(f.native.checkForUpdates).toHaveBeenCalledTimes(1)
  updater.dispose()
  updater.dispose()
  f.native.emit('update-downloaded')
  updater.quitAndInstall()
  expect(f.native.quitAndInstall).not.toHaveBeenCalled()
  expect(f.native.listeners('update-downloaded')).toEqual([unrelated])
  expect(f.native.listenerCount('error')).toBe(0)
  fs.rmSync(f.root, { recursive: true, force: true })
})

it('supplies the network transport when a custom AppAdapter isolates updater writes', async () => {
  const f = fixture()
  let executor: ProviderRuntimeOptions['executor'] | undefined
  const info = { version: '2.1.0', files: [], path: '', sha512: '', releaseDate: '2026-09-01' }
  const options: CustomPublishOptions = {
    provider: 'custom',
    updateProvider: class {
      constructor(_config: unknown, _updater: unknown, runtime: ProviderRuntimeOptions) {
        executor = runtime.executor
      }
      setRequestHeaders() {}
      async getLatestVersion() {
        return info
      }
    }
  }
  const updater = new f.Updater(options, f.adapter)
  updater.logger = null
  updater.autoDownload = false
  updater.allowDowngrade = true
  try {
    expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(true)
    expect(typeof executor?.download).toBe('function')
    expect(fs.existsSync(path.join(f.root, '.updaterId'))).toBe(true)
  } finally {
    updater.dispose()
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

// A normal RPM install may keep the newer package and report success instead of installing the bridge.
it.each(['zypper', 'dnf', 'yum', 'rpm'] as const)(
  'uses %s downgrade semantics only for an older target',
  async (manager) => {
    const { RpmUpdater } = await import('electron-updater')
    const f = fixture()
    const commands: string[][] = []
    class TestUpdater extends RpmUpdater {
      protected get installerPath() {
        return '/tmp/bridge.rpm'
      }
      protected detectPackageManager() {
        return manager
      }
      protected runCommandWithSudoIfNeeded(command: string[]) {
        commands.push(command)
        return ''
      }
      installDownloaded() {
        return this.doInstall({ isSilent: false, isForceRunAfter: false, isAdminRightsRequired: false })
      }
    }
    try {
      for (const version of ['2.1.0', '2.3.0']) {
        const updater = new TestUpdater(
          {
            provider: 'custom',
            updateProvider: class {
              setRequestHeaders() {}
              async getLatestVersion() {
                return { version, files: [], path: '', sha512: '', releaseDate: '2026-09-01' }
              }
            }
          },
          f.adapter
        )
        updater.logger = null
        updater.autoDownload = false
        updater.allowDowngrade = true
        expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(true)
        expect(updater.installDownloaded()).toBe(true)
        const command = commands.at(-1)!
        if (manager === 'dnf' || manager === 'yum') {
          expect(command.slice(0, 2)).toEqual([manager, version === '2.1.0' ? 'downgrade' : 'install'])
        } else {
          expect(command.includes('--oldpackage')).toBe(version === '2.1.0')
        }
        expect(command.at(-1)).toBe('/tmp/bridge.rpm')
      }
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true })
    }
  }
)

const portableOutcomes = [
  'ready',
  'error',
  'exit',
  ...(process.platform === 'win32' ? (['powershell'] as const) : [])
] as const

it.each(portableOutcomes)('portable handoff keeps the app alive until helper readiness: %s', async (outcome) => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('electron-updater/out/PortableUpdater.js')
  const localRequire = createRequire(entry)
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    unref: vi.fn(),
    kill: vi.fn()
  })
  const nativeReadiness = Promise.withResolvers<void>()
  const spawn = vi.fn((file: string, args: string[], options: SpawnOptions) => {
    if (outcome !== 'powershell') return child
    const probe = Buffer.from("[Console]::Out.WriteLine('ready')", 'utf16le').toString('base64')
    return spawnProcess(file, [...args.slice(0, -1), probe], options)
  })
  const errors: Error[] = []
  const quit = vi.fn(() => nativeReadiness.resolve())
  const native = new EventEmitter()
  let updateExit = false
  native.on('before-quit-for-update', () => {
    updateExit = true
  })
  class Base {
    installerPath = '/cache/download.exe'
    app = { quit }
    _logger = { error: vi.fn() }
    dispatchError(error: Error) {
      errors.push(error)
      if (outcome === 'powershell') nativeReadiness.reject(error)
    }
  }
  const exports: {
    PortableUpdater?: new () => Base & { portableExecutable: string; portableSha512: string; quitAndInstall(): void }
  } = {}
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    exports,
    Buffer,
    process: { pid: 123, env: { SystemRoot: outcome === 'powershell' ? process.env.SystemRoot : '/Windows' } },
    setTimeout,
    clearTimeout,
    require: (name: string) =>
      name === './NsisUpdater'
        ? { NsisUpdater: Base }
        : name === 'child_process'
          ? { spawn }
          : name === 'electron'
            ? { autoUpdater: native }
            : localRequire(name)
  })
  const updater = new exports.PortableUpdater!()
  updater.portableExecutable = path.resolve("/portable/中文 ' $test.exe")
  updater.portableSha512 = 'pinned'
  updater.quitAndInstall()
  updater.quitAndInstall()
  expect(spawn.mock.calls).toHaveLength(1)
  expect(quit).not.toHaveBeenCalled()
  if (outcome === 'powershell') {
    await nativeReadiness.promise
    expect(updateExit).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
  } else if (outcome === 'ready') {
    child.stdout.emit('data', Buffer.from('rea'))
    expect(quit).not.toHaveBeenCalled()
    child.stdout.emit('data', Buffer.from('dy\r\n'))
    expect(updateExit).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
  } else {
    if (outcome === 'error') child.emit('error', new Error('PowerShell unavailable'))
    else child.emit('exit', 1)
    expect(quit).not.toHaveBeenCalled()
    expect(updateExit).toBe(false)
    expect(errors).toHaveLength(1)
  }
})
