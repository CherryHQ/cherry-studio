import { pathToFileURL } from 'node:url'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { IpcChannel } from '@shared/IpcChannel'

import { IpcApiService } from '../IpcApiService'

const { appGetMock, getPathMock } = vi.hoisted(() => ({ appGetMock: vi.fn(), getPathMock: vi.fn(() => '/app') }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  result.application.get.mockImplementation(appGetMock)
  result.application.getPath.mockImplementation(getPathMock)
  return result
})

const dispatchMock = vi.fn()
const sendSpy = vi.fn()
let windowManager: {
  getWindowIdByWebContents: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  getWindow: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  broadcast: ReturnType<typeof vi.fn<(...args: any[]) => any>>
}

/** Keep the real router; its dispatch algorithm is tested separately from this transport boundary. */
function makeService(): IpcApiService {
  const svc = new IpcApiService()
  vi.spyOn(svc['router'], 'dispatch').mockImplementation(dispatchMock)
  return svc
}

/** The callback registered on the IpcApi_Request channel during onInit. */
function registeredHandler() {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IpcChannel.IpcApi_Request)
  if (!call) throw new Error('IpcApi request handler was not registered')
  return call[1] as (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Admission tests pass partial sender/frame fixtures through the real sender trust gate.
    event: unknown,
    route: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This registered IPC entry receives raw renderer input before the router selects and parses its schema.
    input: unknown
  ) => ReturnType<IpcApiService['handleRequest']>
}

const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: pathToFileURL('/app/index.html').href, parent: null }
}
const webviewEvent = {
  sender: { getType: () => 'webview' },
  senderFrame: { url: pathToFileURL('/app/index.html').href, parent: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  windowManager = {
    getWindowIdByWebContents: vi.fn(() => 'win-7'),
    getWindow: vi.fn(() => ({ isDestroyed: () => false, webContents: { send: sendSpy } })),
    broadcast: vi.fn()
  }
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('IpcApiService request handling', () => {
  it('dispatches a trusted request and wraps the result as { ok: true, data }', async () => {
    dispatchMock.mockResolvedValue({ sum: 3 })
    const svc = makeService()
    await svc._doInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', { a: 1, b: 2 })

    expect(result).toEqual({ ok: true, data: { sum: 3 } })
    expect(dispatchMock).toHaveBeenCalledWith('demo.add', { a: 1, b: 2 }, { senderId: 'win-7' })
  })

  it('passes senderId=null when the caller is not a managed window', async () => {
    windowManager.getWindowIdByWebContents.mockReturnValue(undefined)
    dispatchMock.mockResolvedValue(null)
    const svc = makeService()
    await svc._doInit()

    await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(dispatchMock).toHaveBeenCalledWith('demo.add', {}, { senderId: null })
  })

  it('rejects an untrusted (webview) sender before dispatch and returns FORBIDDEN_SENDER', async () => {
    const svc = makeService()
    await svc._doInit()

    const result = await registeredHandler()(webviewEvent, 'demo.add', { a: 1, b: 2 })

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN_SENDER' }) })
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('logs a warning (audit trail) when a sender is rejected', async () => {
    const svc = makeService()
    await svc._doInit()

    await registeredHandler()(webviewEvent, 'demo.add', { a: 1 })

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Rejected IpcApi request from untrusted sender',
      expect.objectContaining({ route: 'demo.add', senderType: 'webview' })
    )
  })

  it('serializes a thrown IpcError into a structured { ok: false, error } result (never rejects)', async () => {
    dispatchMock.mockRejectedValue(new IpcError('ROUTE_NOT_FOUND', 'Unknown IpcApi route: demo.add'))
    const svc = makeService()
    await svc._doInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(result).toEqual({ ok: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Unknown IpcApi route: demo.add' } })
  })

  it('normalizes a thrown native Error into an INTERNAL error result', async () => {
    dispatchMock.mockRejectedValue(new Error('handler exploded'))
    const svc = makeService()
    await svc._doInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'handler exploded', reportingHandled: true }
    })
  })

  it('removes the ipcMain handler when the service stops', async () => {
    const svc = makeService()
    await svc._doInit()
    await svc._doStop()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IpcChannel.IpcApi_Request)
  })
})

describe('IpcApiService event sending', () => {
  it('broadcast() fans an event out to all windows via WindowManager.broadcast', () => {
    const svc = makeService()
    svc.broadcast('mcp.catalog.changed', { serverId: 'server-1', kind: 'prompts' })
    expect(windowManager.broadcast).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'mcp.catalog.changed', {
      serverId: 'server-1',
      kind: 'prompts'
    })
  })

  it('send() directs an event to one window resolved from its WindowId', () => {
    const svc = makeService()
    svc.send('win-1', 'window.maximized_changed', true)

    expect(windowManager.getWindow).toHaveBeenCalledWith('win-1')
    expect(sendSpy).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'window.maximized_changed', true)
  })

  it('send() is a no-op when the target window is already gone', () => {
    windowManager.getWindow.mockReturnValue(undefined)
    const svc = makeService()
    expect(() => svc.send('win-gone', 'window.maximized_changed', true)).not.toThrow()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('send() is a no-op when the window is destroyed but not yet unregistered (the close gap)', () => {
    // getWindow() reads the registry without filtering destroyed windows; destroy() is
    // synchronous but the 'closed' handler that unregisters runs a tick later, so a
    // directed send in that gap would hit a destroyed webContents and throw. Match the
    // WindowManager.broadcast "skips destroyed" contract.
    windowManager.getWindow.mockReturnValue({ isDestroyed: () => true, webContents: { send: sendSpy } })
    const svc = makeService()
    expect(() => svc.send('win-dying', 'window.maximized_changed', true)).not.toThrow()
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
