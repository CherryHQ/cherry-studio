import { BaseService, Phase } from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { IpcError } from '@shared/ipc/errors'
import { IpcChannel } from '@shared/IpcChannel'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcApiService } from '../IpcApiService'

const { appGetMock, getPathMock } = vi.hoisted(() => ({ appGetMock: vi.fn(), getPathMock: vi.fn(() => '/app') }))
vi.mock('@application', () => ({ application: { get: appGetMock, getPath: getPathMock } }))

const dispatchMock = vi.fn()
const sendSpy = vi.fn()
let windowManager: {
  getWindowIdByWebContents: ReturnType<typeof vi.fn>
  getWindow: ReturnType<typeof vi.fn>
  broadcast: ReturnType<typeof vi.fn>
}

/** Build a service, then field-inject a dispatch stub (the router itself is tested separately). */
function makeService(): IpcApiService {
  const svc = new IpcApiService()
  ;(svc as unknown as { router: { dispatch: typeof dispatchMock } }).router = { dispatch: dispatchMock }
  return svc
}

/** The callback registered on the IpcApi_Request channel during onInit. */
function registeredHandler() {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === IpcChannel.IpcApi_Request)
  return call?.[1] as (event: unknown, route: string, input: unknown, meta?: unknown) => Promise<unknown>
}

const trustedEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: 'file:///app/index.html', parent: null }
}
const webviewEvent = {
  sender: { getType: () => 'webview' },
  senderFrame: { url: 'file:///app/index.html', parent: null }
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

describe('IpcApiService lifecycle metadata', () => {
  it('runs in the BeforeReady phase (peer of DataApiService, registered before the first window)', () => {
    expect(getPhase(IpcApiService)).toBe(Phase.BeforeReady)
  })
})

describe('IpcApiService request handling', () => {
  it('registers a single ipcMain handler on the IpcApi_Request channel', () => {
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()
    expect(ipcMain.handle).toHaveBeenCalledWith(IpcChannel.IpcApi_Request, expect.any(Function))
  })

  it('dispatches a trusted request and wraps the result as { ok: true, data }', async () => {
    dispatchMock.mockResolvedValue({ sum: 3 })
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', { a: 1, b: 2 })

    expect(result).toEqual({ ok: true, data: { sum: 3 } })
    expect(dispatchMock).toHaveBeenCalledWith('demo.add', { a: 1, b: 2 }, { senderId: 'win-7' })
  })

  it('passes senderId=null when the caller is not a managed window', async () => {
    windowManager.getWindowIdByWebContents.mockReturnValue(undefined)
    dispatchMock.mockResolvedValue(null)
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(dispatchMock).toHaveBeenCalledWith('demo.add', {}, { senderId: null })
  })

  it('rejects an untrusted (webview) sender before dispatch and returns FORBIDDEN_SENDER', async () => {
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    const result = await registeredHandler()(webviewEvent, 'demo.add', { a: 1, b: 2 })

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FORBIDDEN_SENDER' }) })
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('logs a warning (audit trail) when a sender is rejected', async () => {
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    await registeredHandler()(webviewEvent, 'demo.add', { a: 1 })

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Rejected IpcApi request from untrusted sender',
      expect.objectContaining({ route: 'demo.add', senderType: 'webview' })
    )
  })

  it('does not log a rejection warning for a trusted dispatch', async () => {
    dispatchMock.mockResolvedValue({})
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it('serializes a thrown IpcError into a structured { ok: false, error } result (never rejects)', async () => {
    dispatchMock.mockRejectedValue(new IpcError('ROUTE_NOT_FOUND', 'Unknown IpcApi route: demo.add'))
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(result).toEqual({ ok: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Unknown IpcApi route: demo.add' } })
  })

  it('normalizes a thrown native Error into an INTERNAL error result', async () => {
    dispatchMock.mockRejectedValue(new Error('handler exploded'))
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()

    const result = await registeredHandler()(trustedEvent, 'demo.add', {})

    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'handler exploded' } })
  })

  it('removes the ipcMain handler when its disposables are cleaned up', () => {
    const svc = makeService()
    ;(svc as unknown as { onInit(): void }).onInit()
    const disposables = (svc as unknown as { _disposables: Array<{ dispose: () => void }> })._disposables
    disposables.forEach((d) => d.dispose())
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(IpcChannel.IpcApi_Request)
  })
})

describe('IpcApiService event sending', () => {
  it('broadcast() fans an event out to all windows via WindowManager.broadcast', () => {
    const svc = makeService()
    ;(svc.broadcast as unknown as (e: string, p: unknown) => void)('window.resized', { width: 800 })
    expect(windowManager.broadcast).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'window.resized', { width: 800 })
  })

  it('send() directs an event to one window resolved from its WindowId', () => {
    const svc = makeService()
    ;(svc.send as unknown as (id: string, e: string, p: unknown) => void)('win-1', 'window.resized', { width: 640 })
    expect(windowManager.getWindow).toHaveBeenCalledWith('win-1')
    expect(sendSpy).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'window.resized', { width: 640 })
  })

  it('send() is a no-op when the target window is already gone', () => {
    windowManager.getWindow.mockReturnValue(undefined)
    const svc = makeService()
    expect(() =>
      (svc.send as unknown as (id: string, e: string, p: unknown) => void)('win-gone', 'window.resized', {})
    ).not.toThrow()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('send() is a no-op when the window is destroyed but not yet unregistered (the close gap)', () => {
    // getWindow() reads the registry without filtering destroyed windows; destroy() is
    // synchronous but the 'closed' handler that unregisters runs a tick later, so a
    // directed send in that gap would hit a destroyed webContents and throw. Match the
    // WindowManager.broadcast "skips destroyed" contract.
    windowManager.getWindow.mockReturnValue({ isDestroyed: () => true, webContents: { send: sendSpy } })
    const svc = makeService()
    expect(() =>
      (svc.send as unknown as (id: string, e: string, p: unknown) => void)('win-dying', 'window.resized', {})
    ).not.toThrow()
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
