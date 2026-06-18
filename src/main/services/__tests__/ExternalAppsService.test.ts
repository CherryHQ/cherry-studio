import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock } = vi.hoisted(() => {
  const appMock = { getApplicationInfoForProtocol: vi.fn() }
  return { appMock }
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

vi.mock('electron', () => ({ app: appMock }))

vi.mock('@shared/externalApp/config', () => ({
  EXTERNAL_APPS: [{ id: 'vscode', name: 'VS Code', protocol: 'vscode' }]
}))

// Bypass real BaseService ipc internals — capture ipcHandle registrations instead.
vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    registerDisposable = <T>(d: T) => d
  }
  return { ...actual, BaseService: StubBase }
})

import { ExternalAppsService } from '../ExternalAppsService'

describe('ExternalAppsService', () => {
  let svc: ExternalAppsService

  beforeEach(() => {
    svc = new ExternalAppsService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers the ExternalApps_DetectInstalled IPC handler on init', async () => {
    await (svc as any).onInit()

    const ipcHandle = (svc as any).ipcHandle as ReturnType<typeof vi.fn>
    expect(ipcHandle).toHaveBeenCalledWith(IpcChannel.ExternalApps_DetectInstalled, expect.any(Function))
  })

  it('detects an installed app and serves subsequent calls from cache', async () => {
    appMock.getApplicationInfoForProtocol.mockResolvedValue({ name: 'VS Code', path: '/Applications/VSCode.app' })

    const first = await svc.detectInstalledApps()
    expect(first).toEqual([{ id: 'vscode', name: 'VS Code', protocol: 'vscode', path: '/Applications/VSCode.app' }])

    // Within the cache window a second call must not re-probe protocols.
    appMock.getApplicationInfoForProtocol.mockClear()
    const second = await svc.detectInstalledApps()
    expect(second).toEqual(first)
    expect(appMock.getApplicationInfoForProtocol).not.toHaveBeenCalled()
  })

  it('omits apps that are not installed', async () => {
    appMock.getApplicationInfoForProtocol.mockResolvedValue({ name: '', path: '' })

    const result = await svc.detectInstalledApps()

    expect(result).toEqual([])
  })
})
