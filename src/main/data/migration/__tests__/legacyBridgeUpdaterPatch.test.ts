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
