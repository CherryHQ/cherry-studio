import type { MockMainLoggerService } from '@test-mocks/MainLoggerService'
import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getApplicationInfoForProtocol: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getApplicationInfoForProtocol: mocks.getApplicationInfoForProtocol }
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn
}))

import type { externalAppsService } from '../ExternalAppsService'

type ExternalAppsServiceInstance = typeof externalAppsService

const WT_ALIAS_PATH = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'

function mockSpawn() {
  const listeners = new Map<string, (...args: any[]) => void>()
  const child = {
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      listeners.set(event, listener)
      return child
    })
  }
  mocks.spawn.mockReturnValue(child as never)
  return {
    emitError: (error: Error) => listeners.get('error')?.(error),
    emitClose: (code: number | null, signal: NodeJS.Signals | null = null) => listeners.get('close')?.(code, signal)
  }
}

describe('ExternalAppsService', () => {
  let service: ExternalAppsServiceInstance
  let logger: MockMainLoggerService
  let lstatSyncSpy: MockInstance<fs.StatSyncFn>
  let statSyncSpy: MockInstance<fs.StatSyncFn>
  let platformSpy: MockInstance<() => NodeJS.Platform>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\test\\AppData\\Local')

    mocks.getApplicationInfoForProtocol.mockImplementation(async (protocol: string) => {
      switch (protocol) {
        case 'vscode://':
          return { name: 'Visual Studio Code', path: '/app/vscode' }
        case 'cursor://':
          return { name: 'Cursor', path: '/app/cursor' }
        default:
          return { name: '', path: '' }
      }
    })

    service = (await import('../ExternalAppsService')).externalAppsService
    logger = (await import('@logger')).loggerService as unknown as typeof logger
    lstatSyncSpy = vi.spyOn(fs, 'lstatSync')
    statSyncSpy = vi.spyOn(fs, 'statSync')
    platformSpy = vi.spyOn(process, 'platform', 'get')
    lstatSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    platformSpy.mockReturnValue('win32')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('detects installed protocol apps and filters out missing ones', async () => {
    const apps = await service.detectInstalledApps()

    expect(apps).toEqual([
      { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'], path: '/app/vscode' },
      { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'], path: '/app/cursor' }
    ])
    expect(mocks.getApplicationInfoForProtocol).toHaveBeenCalledWith('vscode://')
    expect(mocks.getApplicationInfoForProtocol).toHaveBeenCalledWith('cursor://')
    expect(mocks.getApplicationInfoForProtocol).toHaveBeenCalledWith('zed://')
  })

  it('detects Windows Terminal by inspecting its App Execution Alias without following it', async () => {
    lstatSyncSpy.mockReturnValue({} as fs.Stats)
    statSyncSpy.mockImplementation(() => {
      throw new Error('EACCES')
    })

    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toEqual({
      id: 'wt',
      name: 'Windows Terminal',
      executable: 'wt.exe',
      tags: ['terminal'],
      path: WT_ALIAS_PATH
    })
    expect(lstatSyncSpy).toHaveBeenCalledWith(WT_ALIAS_PATH)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not detect Windows Terminal when the App Execution Alias is missing', async () => {
    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toBeUndefined()
  })

  it('does not detect Windows Terminal on non-Windows platforms', async () => {
    platformSpy.mockReturnValue('darwin')
    lstatSyncSpy.mockReturnValue({} as fs.Stats)

    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toBeUndefined()
    expect(lstatSyncSpy).not.toHaveBeenCalled()
  })

  it('spawns the controlled alias path without a separate existence precheck', async () => {
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\project')
    child.emitClose(0)
    await openPromise

    expect(lstatSyncSpy).not.toHaveBeenCalled()
    const launchContext = {
      appId: 'wt',
      executablePath: WT_ALIAS_PATH,
      targetPath: 'C:\\work\\project',
      directory: 'C:\\work\\project'
    }
    expect(logger.info).toHaveBeenCalledWith('Launching external app', launchContext)
    expect(logger.info).toHaveBeenCalledWith('External app launched', launchContext)
    expect(mocks.spawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object), shell: false, windowsHide: false })
    )
  })

  it('removes Cherry proxy settings from a copied environment before spawning', async () => {
    vi.stubEnv('HTTP_PROXY', 'http://user:password@proxy.example')
    vi.stubEnv('ALL_PROXY', 'socks5://proxy.example')
    vi.stubEnv('NO_PROXY', 'localhost')
    vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_RULES', 'http://user:password@proxy.example')
    vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES', 'localhost')
    vi.stubEnv('USER_DEFINED_TOKEN', 'preserve-me')
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\project')
    child.emitClose(0)
    await openPromise

    const options = mocks.spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }
    expect(options.env).not.toBe(process.env)
    expect(options.env).toMatchObject({
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      USER_DEFINED_TOKEN: 'preserve-me'
    })
    expect(options.env).not.toHaveProperty('HTTP_PROXY')
    expect(options.env).not.toHaveProperty('ALL_PROXY')
    expect(options.env).not.toHaveProperty('NO_PROXY')
    expect(options.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_RULES')
    expect(options.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES')
    expect(process.env.HTTP_PROXY).toBe('http://user:password@proxy.example')
    expect(process.env.CHERRY_STUDIO_NODE_PROXY_RULES).toBe('http://user:password@proxy.example')
  })

  it('opens a terminal in the containing directory when the target is a file', async () => {
    statSyncSpy.mockReturnValue({ isFile: () => true } as fs.Stats)
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\project\\report.xlsx')
    child.emitClose(0)
    await openPromise

    expect(mocks.spawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('keeps a directory target as-is when opening a terminal', async () => {
    statSyncSpy.mockReturnValue({ isFile: () => false } as fs.Stats)
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\project')
    child.emitClose(0)
    await openPromise

    expect(mocks.spawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('opens in the containing directory when the target file does not exist yet', async () => {
    statSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\project\\draft.txt')
    child.emitClose(0)
    await openPromise

    expect(mocks.spawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('keeps a non-existent extension-less path as-is when opening a terminal', async () => {
    statSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work\\brand-new-project')
    child.emitClose(0)
    await openPromise

    expect(mocks.spawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\brand-new-project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('rejects when the requested app is not executable-based', async () => {
    await expect(service.open('vscode', 'C:\\work')).rejects.toThrow('cannot be launched as a process')
    await expect(service.open('unknown' as never, 'C:\\work')).rejects.toThrow('cannot be launched as a process')
  })

  it('rejects before spawning when the executable path cannot be resolved on this platform', async () => {
    platformSpy.mockReturnValue('darwin')

    await expect(service.open('wt', '/tmp/work')).rejects.toThrow('was not found')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('logs and forwards spawn errors only once', async () => {
    const child = mockSpawn()
    const error = new Error('spawn EACCES')

    const openPromise = service.open('wt', 'C:\\work')
    child.emitError(error)
    child.emitClose(1)

    await expect(openPromise).rejects.toBe(error)
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith('Failed to launch external app', error, {
      appId: 'wt',
      executablePath: WT_ALIAS_PATH,
      targetPath: 'C:\\work',
      directory: 'C:\\work'
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs and rejects when Windows Terminal exits unsuccessfully', async () => {
    const child = mockSpawn()

    const openPromise = service.open('wt', 'C:\\work')
    child.emitClose(1)

    await expect(openPromise).rejects.toThrow('exited with code 1')
    expect(logger.warn).toHaveBeenCalledWith('External app exited unsuccessfully', {
      appId: 'wt',
      executablePath: WT_ALIAS_PATH,
      targetPath: 'C:\\work',
      directory: 'C:\\work',
      exitCode: 1,
      signal: null
    })
  })

  it('caches detection results for five minutes', async () => {
    await service.detectInstalledApps()
    await service.detectInstalledApps()

    expect(mocks.getApplicationInfoForProtocol).toHaveBeenCalledTimes(3)
  })
})
