import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appMock,
  loggerMock,
  handlersMock,
  ipcApiServiceMock,
  mainWindowServiceMock,
  mcpServerServiceMock,
  openRouteInMainWindowMock,
  openSettingsInMainWindowMock,
  platformMock,
  windowManagerMock
} = vi.hoisted(() => {
  const appMock = {
    on: vi.fn(),
    removeListener: vi.fn(),
    setAsDefaultProtocolClient: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  const handlersMock = {
    parseMcpInstallProtocolUrl: vi.fn(),
    handleNavigateProtocolUrl: vi.fn(),
    handleProvidersProtocolUrl: vi.fn()
  }
  const ipcApiServiceMock = {
    broadcast: vi.fn()
  }
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const mcpServerServiceMock = {
    createMany: vi.fn()
  }
  const openSettingsInMainWindowMock = vi.fn()
  const platformMock = {
    isLinux: false,
    isPortable: false,
    isWin: false
  }
  const windowManagerMock = {
    getWindowsByType: vi.fn(() => [
      { isDestroyed: (): boolean => false, webContents: { isDestroyed: (): boolean => false } }
    ]),
    getWindowType: vi.fn(() => 'main'),
    onWindowCreatedByType: vi.fn<(type: string, listener: unknown) => () => void>(() => vi.fn()),
    onWindowDestroyedByType: vi.fn<(type: string, listener: unknown) => () => void>(() => vi.fn())
  }
  return {
    appMock,
    loggerMock,
    handlersMock,
    ipcApiServiceMock,
    mainWindowServiceMock,
    mcpServerServiceMock,
    openRouteInMainWindowMock: vi.fn(),
    openSettingsInMainWindowMock,
    platformMock,
    windowManagerMock
  }
})

vi.mock('electron', () => ({ app: appMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: mcpServerServiceMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    IpcApiService: ipcApiServiceMock,
    MainWindowService: mainWindowServiceMock,
    WindowManager: windowManagerMock
  })
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected registerDisposable<T>(disposable: T): T {
      return disposable
    }
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background' }
  }
})

vi.mock('@main/services/mainWindowNavigation', () => ({
  openRouteInMainWindow: openRouteInMainWindowMock,
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

vi.mock('@main/core/platform', () => platformMock)

vi.mock('../handlers/mcpInstall', () => ({
  parseMcpInstallProtocolUrl: handlersMock.parseMcpInstallProtocolUrl
}))

vi.mock('../handlers/navigate', () => ({
  handleNavigateProtocolUrl: handlersMock.handleNavigateProtocolUrl
}))

vi.mock('../handlers/providersImport', () => ({
  handleProvidersProtocolUrl: handlersMock.handleProvidersProtocolUrl
}))

import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

import * as openWorkspace from '../handlers/openWorkspace'
import { ProtocolService } from '../ProtocolService'

describe('ProtocolService', () => {
  const dbh = setupTestDatabase()
  let folder: string
  let service: ProtocolService
  let originalArgv: string[]
  let originalDefaultApp: boolean | undefined

  function setDefaultApp(value: boolean | undefined) {
    if (value === undefined) {
      Reflect.deleteProperty(process, 'defaultApp')
    } else {
      ;(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp = value
    }
  }

  async function markProtocolHandlingReady() {
    await (service as any).onAllReady()
    service.onMainRendererReady('main-1')
  }

  beforeEach(async () => {
    originalArgv = process.argv
    originalDefaultApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp
    vi.clearAllMocks()
    process.argv = ['electron', '.']
    setDefaultApp(true)
    folder = await fs.mkdtemp(path.join(tmpdir(), 'protocol-workspace-'))
    windowManagerMock.getWindowsByType.mockReturnValue([
      { isDestroyed: () => false, webContents: { isDestroyed: () => false } }
    ])
    platformMock.isLinux = false
    platformMock.isPortable = false
    platformMock.isWin = false
    service = new ProtocolService()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(folder, { recursive: true, force: true })
    process.argv = originalArgv
    setDefaultApp(originalDefaultApp)
    vi.unstubAllEnvs()
  })

  it('logs malformed protocol URLs instead of throwing', async () => {
    await markProtocolHandlingReady()

    expect(() => (service as any).handleProtocolUrl('not a url')).not.toThrow()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle protocol URL', expect.any(TypeError))
  })

  it('registers the packaged protocol handler without dev arguments', async () => {
    setDefaultApp(false)
    process.argv = ['Cherry Studio.exe']

    await (service as any).onInit()

    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledWith('cherrystudio')
  })

  it('registers the stable launcher for packaged Windows portable builds', async () => {
    setDefaultApp(false)
    platformMock.isPortable = true
    platformMock.isWin = true
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'D:\\Apps\\Cherry Studio Portable.exe')

    await (service as any).onInit()

    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledWith(
      'cherrystudio',
      'D:\\Apps\\Cherry Studio Portable.exe',
      []
    )
  })

  it('registers the dev protocol handler with an absolute app entry', async () => {
    setDefaultApp(true)
    process.argv = ['electron.exe', '.']

    await (service as any).onInit()

    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1)
    expect(appMock.setAsDefaultProtocolClient).toHaveBeenCalledWith('cherrystudio', process.execPath, [
      path.resolve(process.cwd(), '.')
    ])
  })

  it('logs asynchronous providers handler failures', async () => {
    const error = new Error('failed')
    handlersMock.handleProvidersProtocolUrl.mockRejectedValueOnce(error)
    await markProtocolHandlingReady()

    ;(service as any).handleProtocolUrl('cherrystudio://providers/api-keys?v=1&data=abc')

    await vi.waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle providers protocol URL', error)
    })
  })

  it('broadcasts unknown protocol hosts to all windows', async () => {
    await markProtocolHandlingReady()

    ;(service as any).handleProtocolUrl('cherrystudio://unknown/path?foo=bar')

    expect(ipcApiServiceMock.broadcast).toHaveBeenCalledWith('navigation.protocol_data', {
      url: 'cherrystudio://unknown/path?foo=bar',
      params: { foo: 'bar' }
    })
  })

  describe('protocol URL readiness', () => {
    function getOpenUrlHandler() {
      const call = appMock.on.mock.calls.find((call) => call[0] === 'open-url')
      if (!call) throw new Error('open-url listener not registered')
      return call[1] as (event: { preventDefault: () => void }, url: string) => void
    }

    it('queues a cold-start URL until services and the main renderer are ready and replays it only once', async () => {
      process.argv = ['electron', '.']
      await (service as any).onInit()
      const handler = getOpenUrlHandler()
      const event = { preventDefault: vi.fn() }

      handler(event, 'cherrystudio://mcp/install?servers=abc')

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(handlersMock.parseMcpInstallProtocolUrl).not.toHaveBeenCalled()

      await (service as any).onAllReady()
      await (service as any).onAllReady()

      expect(handlersMock.parseMcpInstallProtocolUrl).not.toHaveBeenCalled()

      service.onMainRendererReady('main-1')
      service.onMainRendererReady('main-1')

      expect(handlersMock.parseMcpInstallProtocolUrl).toHaveBeenCalledTimes(1)
      expect(handlersMock.parseMcpInstallProtocolUrl.mock.calls[0][0].href).toBe(
        'cherrystudio://mcp/install?servers=abc'
      )
    })

    it('handles a hot-start URL immediately', async () => {
      await markProtocolHandlingReady()

      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')

      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledTimes(1)
      expect(handlersMock.handleNavigateProtocolUrl.mock.calls[0][0].href).toBe('cherrystudio://navigate/agents')
    })

    it('keeps MCP install payloads in Main until installation succeeds', async () => {
      const servers = [
        {
          name: 'remote-server',
          baseUrl: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
          installSource: 'protocol',
          isActive: false,
          isTrusted: false,
          installedAt: 1
        }
      ]
      handlersMock.parseMcpInstallProtocolUrl.mockReturnValueOnce(servers)
      await markProtocolHandlingReady()

      ;(service as any).handleProtocolUrl('cherrystudio://mcp/install?servers=secret')

      const path = openSettingsInMainWindowMock.mock.calls[0][0] as string
      expect(path).toMatch(/^\/settings\/mcp\/servers\?protocolInstallRequestId=[0-9a-f-]+$/)
      expect(path).not.toContain('Bearer')
      const [request] = service.listPendingMcpInstallRequests('main-1')
      expect(request).toEqual({ requestId: expect.any(String), servers })
      expect(service.listPendingMcpInstallRequests('main-1')).toEqual([request])

      const createdServers = [{ ...servers[0], id: 'created-server' }]
      mcpServerServiceMock.createMany.mockReturnValueOnce(createdServers)
      expect(service.installPendingMcpInstallRequest('main-1', request.requestId)).toEqual(createdServers)
      expect(mcpServerServiceMock.createMany).toHaveBeenCalledWith(servers)
      expect(service.listPendingMcpInstallRequests('main-1')).toEqual([])
    })

    it('retains a failed MCP install request until it is cancelled', async () => {
      const servers = [
        {
          name: 'local-server',
          command: 'node',
          installSource: 'protocol',
          isActive: false,
          isTrusted: false,
          installedAt: 1
        }
      ]
      handlersMock.parseMcpInstallProtocolUrl.mockReturnValueOnce(servers)
      mcpServerServiceMock.createMany.mockImplementationOnce(() => {
        throw new Error('duplicate server')
      })
      await markProtocolHandlingReady()
      ;(service as any).handleProtocolUrl('cherrystudio://mcp/install?servers=duplicate')
      const [request] = service.listPendingMcpInstallRequests('main-1')

      expect(() => service.installPendingMcpInstallRequest('main-1', request.requestId)).toThrow('duplicate server')
      expect(service.listPendingMcpInstallRequests('main-1')).toEqual([request])

      service.cancelPendingMcpInstallRequest('main-1', request.requestId)
      expect(service.listPendingMcpInstallRequests('main-1')).toEqual([])
    })

    it('queues URLs again while the main renderer reloads or recovers from a crash', async () => {
      await (service as any).onInit()
      const listeners = new EventEmitter()
      const onWindowCreated = windowManagerMock.onWindowCreatedByType.mock.calls[0][1] as (managed: {
        window: { webContents: { on: (event: string, listener: () => void) => void } }
      }) => void
      onWindowCreated({
        window: {
          webContents: {
            on: (event: string, listener: () => void) => listeners.on(event, listener)
          }
        }
      })
      await markProtocolHandlingReady()

      listeners.emit('did-start-loading')
      listeners.emit('did-start-navigation', {}, 'https://child.test/', false, false)
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledOnce()
      handlersMock.handleNavigateProtocolUrl.mockClear()
      listeners.emit('did-start-navigation', {}, 'http://localhost:5173/#route', true, true)
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledOnce()
      handlersMock.handleNavigateProtocolUrl.mockClear()
      listeners.emit('did-start-navigation', {}, 'http://localhost:5173/', false, true)
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')
      expect(handlersMock.handleNavigateProtocolUrl).not.toHaveBeenCalled()

      service.onMainRendererReady('main-1')
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledTimes(1)

      listeners.emit('render-process-gone')
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/knowledge')
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledTimes(1)

      service.onMainRendererReady('main-1')
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledTimes(2)
    })

    it('replays queued URLs in order and continues after an invalid URL', async () => {
      const handledUrls: string[] = []
      handlersMock.parseMcpInstallProtocolUrl.mockImplementation((url: URL) => {
        handledUrls.push(url.href)
        return null
      })
      handlersMock.handleNavigateProtocolUrl.mockImplementation((url: URL) => handledUrls.push(url.href))

      ;(service as any).handleProtocolUrl('cherrystudio://mcp/install?servers=first')
      ;(service as any).handleProtocolUrl('not a url')
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')

      await (service as any).onAllReady()

      expect(handledUrls).toEqual([])

      service.onMainRendererReady('main-1')

      expect(handledUrls).toEqual(['cherrystudio://mcp/install?servers=first', 'cherrystudio://navigate/agents'])
      expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle protocol URL', expect.any(TypeError))
    })

    it('waits for services when the main renderer becomes ready first', async () => {
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')

      service.onMainRendererReady('main-1')
      expect(handlersMock.handleNavigateProtocolUrl).not.toHaveBeenCalled()

      await (service as any).onAllReady()

      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledTimes(1)
    })

    it('ignores readiness notifications from non-main windows', async () => {
      windowManagerMock.getWindowType.mockReturnValueOnce('subWindow')
      await (service as any).onAllReady()
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/agents')

      service.onMainRendererReady('subwindow-1')

      expect(handlersMock.handleNavigateProtocolUrl).not.toHaveBeenCalled()
    })
  })

  describe('workspace launch delivery', () => {
    function secondInstance(operand: string) {
      const listener = appMock.on.mock.calls.find(([event]) => event === 'second-instance')?.[1]
      if (!listener) throw new Error('Missing second-instance listener')
      listener({}, ['electron', '.', operand])
    }

    function destroyMain() {
      const listener = windowManagerMock.onWindowDestroyedByType.mock.calls[0][1] as () => void
      listener()
    }

    it('registers and routes a second-instance folder only after readiness', async () => {
      await (service as any).onInit()
      secondInstance(folder)
      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
      await (service as any).onAllReady()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
      service.onMainRendererReady('main-1')
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledOnce())
      const [workspace] = dbh.db.select().from(agentWorkspaceTable).all()
      expect(workspace.path).toBe(folder)
      expect(openRouteInMainWindowMock).toHaveBeenCalledWith(`/app/agents?workspaceId=${workspace.id}`)
    })

    it('registers a cold-start file URL after opening Main and renderer readiness', async () => {
      process.argv = ['electron', '.', pathToFileURL(folder).href]
      await (service as any).onInit()
      await (service as any).onAllReady()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
      service.onMainRendererReady('main-1')
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledOnce())
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ path: folder }])
    })

    it.each(['missing', 'destroyed'])(
      'wakes a %s Main before waiting for readiness, even for rejected input',
      async (state) => {
        await (service as any).onInit()
        windowManagerMock.getWindowsByType.mockReturnValue(
          state === 'missing' ? [] : [{ isDestroyed: () => true, webContents: { isDestroyed: () => true } }]
        )
        ;(service as any).handleProtocolUrl('cherrystudio://open?path=relative')
        expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
        await (service as any).onAllReady()
        expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
        expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
        expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
      }
    )

    it('retains a prepared route across readiness loss without registering it twice or losing the batch', async () => {
      await (service as any).onInit()
      await markProtocolHandlingReady()
      const prepare = openWorkspace.prepareWorkspaceRoute
      let release!: () => void
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      const preparation = vi.spyOn(openWorkspace, 'prepareWorkspaceRoute').mockImplementationOnce(async (directory) => {
        await paused
        return prepare(directory)
      })
      secondInstance(folder)
      secondInstance('relative')
      const next = path.join(folder, 'next')
      await fs.mkdir(next)
      secondInstance(next)
      destroyMain()
      release()
      await vi.waitFor(() => expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1))
      expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
      service.onMainRendererReady('main-1')
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledTimes(2))
      const workspaces = dbh.db.select().from(agentWorkspaceTable).all()
      const idFor = (directory: string) => workspaces.find((row) => row.path === directory)!.id
      expect(openRouteInMainWindowMock.mock.calls).toEqual([
        [`/app/agents?workspaceId=${idFor(folder)}`],
        [`/app/agents?workspaceId=${idFor(next)}`]
      ])
      expect(preparation.mock.calls.map(([directory]) => directory)).toEqual([folder, 'relative', next])
    })

    it('wakes Main for a folder even when an earlier protocol URL is waiting for the renderer', async () => {
      await (service as any).onInit()
      ;(service as any).handleProtocolUrl('cherrystudio://navigate/knowledge')
      secondInstance(folder)
      await (service as any).onAllReady()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
      expect(handlersMock.handleNavigateProtocolUrl).not.toHaveBeenCalled()
      service.onMainRendererReady('main-1')
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledOnce())
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledWith(new URL('cherrystudio://navigate/knowledge'))
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ path: folder }])
    })

    it('retains the prepared route when the live renderer disappears during validation', async () => {
      await (service as any).onInit()
      await markProtocolHandlingReady()
      const prepare = openWorkspace.prepareWorkspaceRoute
      vi.spyOn(openWorkspace, 'prepareWorkspaceRoute').mockImplementationOnce(async (directory) => {
        const route = await prepare(directory)
        windowManagerMock.getWindowsByType.mockReturnValue([])
        return route
      })
      secondInstance(folder)
      await vi.waitFor(() => expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(2))
      expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
      windowManagerMock.getWindowsByType.mockReturnValue([
        { isDestroyed: () => false, webContents: { isDestroyed: () => false } }
      ])
      service.onMainRendererReady('main-1')
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledOnce())
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    })

    it('consumes open deep links in main and decodes special characters exactly once', async () => {
      const directory = path.join(folder, '中文 + # %2F')
      await fs.mkdir(directory)
      await markProtocolHandlingReady()
      const url = new URL('cherrystudio://open')
      url.searchParams.set('path', directory)
      ;(service as any).handleProtocolUrl(url.href)
      await vi.waitFor(() => expect(openRouteInMainWindowMock).toHaveBeenCalledOnce())
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ path: directory }])
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
    })

    it('rejects malformed UTF-8 even when forgiving decoding would name an existing directory', async () => {
      await fs.mkdir(path.join(folder, 'replacement-�'))
      await markProtocolHandlingReady()
      ;(service as any).handleProtocolUrl(`cherrystudio://open?path=${encodeURIComponent(folder)}%2Freplacement-%FF`)
      await vi.waitFor(() => expect((service as any).pendingLaunchInputs).toEqual([]))
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
      expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
    })

    it.each(['%FF', '%', '%C0%AF', 'file%3A%2F%2F%2Ffolder', ''])(
      'quietly consumes rejected open path %j without OAuth broadcast',
      async (value) => {
        await markProtocolHandlingReady()
        ;(service as any).handleProtocolUrl(`cherrystudio://open?path=${value}`)
        await vi.waitFor(() => expect((service as any).pendingLaunchInputs).toEqual([]))
        expect(dbh.db.select().from(agentWorkspaceTable).all()).toEqual([])
        expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
        expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
        expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
      }
    )
  })

  describe('second-instance handler', () => {
    function getSecondInstanceHandler() {
      const call = appMock.on.mock.calls.find((call) => call[0] === 'second-instance')
      if (!call) throw new Error('second-instance listener not registered')
      return call[1] as (event: unknown, argv: string[]) => void
    }

    it('dispatches the URL when argv carries a cherrystudio:// deep link', async () => {
      await (service as any).onInit()
      await markProtocolHandlingReady()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.', 'cherrystudio://navigate/agents'])

      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
      expect(handlersMock.handleNavigateProtocolUrl).toHaveBeenCalledWith(new URL('cherrystudio://navigate/agents'))
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
    })

    it('discards retired OAuth callbacks without broadcasting their authorization codes', async () => {
      await (service as any).onInit()
      await markProtocolHandlingReady()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.', 'cherrystudio://oauth/callback?code=private-code&state=old-state'])

      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
    })

    it('surfaces the main window when argv has no protocol URL', async () => {
      await (service as any).onInit()
      await (service as any).onAllReady()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.'])

      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()
    })
  })
})
