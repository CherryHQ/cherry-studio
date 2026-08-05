import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getApplicationInfoForProtocol: vi.fn(),
  crossPlatformSpawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getApplicationInfoForProtocol: mocks.getApplicationInfoForProtocol }
}))

vi.mock('@main/utils/processRunner', () => ({
  crossPlatformSpawn: mocks.crossPlatformSpawn
}))

import type { externalAppsService } from '../ExternalAppsService'

type ExternalAppsServiceInstance = typeof externalAppsService

const WT_ALIAS_PATH = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'

function mockSpawnExit(code: number) {
  const child = {
    on: vi.fn((event: string, cb: (arg: unknown) => void) => {
      if (event === 'close') cb(code)
      return child
    })
  }
  mocks.crossPlatformSpawn.mockReturnValue(child as never)
  return child
}

describe('ExternalAppsService', () => {
  let service: ExternalAppsServiceInstance
  let existsSyncSpy: MockInstance<(path: fs.PathLike) => boolean>
  let statSyncSpy: MockInstance<fs.StatSyncFn>
  let platformSpy: MockInstance<() => NodeJS.Platform>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\test\\AppData\\Local')

    // Three protocol apps installed (Zed empty-name = not installed), WT alias missing by default.
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

    // Import the fresh singleton first so module-load-time fs usage runs against the real fs,
    // then install the fs/platform spies for the test body.
    service = (await import('../ExternalAppsService')).externalAppsService
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
    statSyncSpy = vi.spyOn(fs, 'statSync')
    platformSpy = vi.spyOn(process, 'platform', 'get')
    existsSyncSpy.mockReturnValue(false)
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

  it('detects Windows Terminal through its App Execution Alias on Windows', async () => {
    existsSyncSpy.mockReturnValue(true)

    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toEqual({
      id: 'wt',
      name: 'Windows Terminal',
      executable: 'wt.exe',
      tags: ['terminal'],
      path: WT_ALIAS_PATH
    })
  })

  it('does not detect Windows Terminal when the App Execution Alias is missing', async () => {
    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toBeUndefined()
  })

  it('does not detect Windows Terminal on non-Windows platforms', async () => {
    platformSpy.mockReturnValue('darwin')
    existsSyncSpy.mockReturnValue(true)

    const apps = await service.detectInstalledApps()

    expect(apps.find((app) => app.id === 'wt')).toBeUndefined()
  })

  it('spawns wt.exe with the target directory when opening a folder', async () => {
    existsSyncSpy.mockReturnValue(true)
    mockSpawnExit(0)

    await service.open('wt', 'C:\\work\\project')

    expect(mocks.crossPlatformSpawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('opens a terminal in the containing directory when the target is a file', async () => {
    existsSyncSpy.mockReturnValue(true)
    statSyncSpy.mockReturnValue({ isFile: () => true } as fs.Stats)
    mockSpawnExit(0)

    await service.open('wt', 'C:\\work\\project\\report.xlsx')

    expect(mocks.crossPlatformSpawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('keeps a directory target as-is when opening a terminal', async () => {
    existsSyncSpy.mockReturnValue(true)
    statSyncSpy.mockReturnValue({ isFile: () => false } as fs.Stats)
    mockSpawnExit(0)

    await service.open('wt', 'C:\\work\\project')

    expect(mocks.crossPlatformSpawn).toHaveBeenCalledWith(
      WT_ALIAS_PATH,
      ['-d', 'C:\\work\\project'],
      expect.objectContaining({ env: expect.any(Object) })
    )
  })

  it('rejects when the requested app is not executable-based', async () => {
    await expect(service.open('vscode', 'C:\\work')).rejects.toThrow('cannot be launched as a process')
    await expect(service.open('unknown' as never, 'C:\\work')).rejects.toThrow('cannot be launched as a process')
  })

  it('rejects when the executable is not installed', async () => {
    existsSyncSpy.mockReturnValue(false)

    await expect(service.open('wt', 'C:\\work')).rejects.toThrow('was not found')
  })

  it('rejects when wt.exe exits with a non-zero code', async () => {
    existsSyncSpy.mockReturnValue(true)
    mockSpawnExit(1)

    await expect(service.open('wt', 'C:\\work')).rejects.toThrow('exited with code 1')
  })

  it('caches detection results for five minutes', async () => {
    await service.detectInstalledApps()
    await service.detectInstalledApps()

    expect(mocks.getApplicationInfoForProtocol).toHaveBeenCalledTimes(3)
  })
})
