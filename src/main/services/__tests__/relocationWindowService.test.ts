import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { browserWindowMock, ipcHandleMock, ipcRemoveHandlerMock, validateSenderMock } = vi.hoisted(() => ({
  browserWindowMock: vi.fn(),
  ipcHandleMock: vi.fn(),
  ipcRemoveHandlerMock: vi.fn(),
  validateSenderMock: vi.fn(() => true)
}))

vi.mock('@main/core/platform', () => ({ isDev: false, isMac: false }))
vi.mock('@application', () => ({ application: { getPath: vi.fn(() => '/app') } }))
vi.mock('@main/ipc/validateSender', () => ({ validateSender: validateSenderMock }))
vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  ipcMain: { handle: ipcHandleMock, removeHandler: ipcRemoveHandlerMock }
}))

import { openUserDataRelocationWindow } from '../relocationWindowService'

interface MockWindow extends EventEmitter {
  webContents: EventEmitter & { send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

let window: MockWindow
let handlers: Map<string, (event: unknown, route: string, input?: unknown) => unknown>

function invoke(route: string, input?: unknown): unknown {
  return handlers.get('ipc-api:request')?.({}, route, input)
}

function makeWindow(): MockWindow {
  const value = new EventEmitter() as MockWindow
  value.webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
  value.isDestroyed = vi.fn(() => false)
  value.loadFile = vi.fn().mockResolvedValue(undefined)
  value.loadURL = vi.fn().mockResolvedValue(undefined)
  value.show = vi.fn()
  value.close = vi.fn(() => {
    let prevented = false
    value.emit('close', { preventDefault: () => (prevented = true) })
    if (!prevented) value.emit('closed')
  })
  return value
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  validateSenderMock.mockReturnValue(true)
  handlers = new Map()
  ipcHandleMock.mockImplementation(
    (channel: string, handler: (event: unknown, route: string, input?: unknown) => unknown) =>
      handlers.set(channel, handler)
  )
  ipcRemoveHandlerMock.mockImplementation((channel: string) => handlers.delete(channel))
  window = makeWindow()
  browserWindowMock.mockReturnValue(window)
})

describe('relocationWindowService', () => {
  it('does not silently replace an existing shared IpcApi handler', () => {
    ipcHandleMock.mockImplementationOnce(() => {
      throw new Error('Attempted to register a second handler')
    })

    expect(() => openUserDataRelocationWindow({ getProgress: () => null, onRestart: vi.fn() })).toThrow(
      'Attempted to register a second handler'
    )
    expect(ipcRemoveHandlerMock).not.toHaveBeenCalled()
    expect(browserWindowMock).not.toHaveBeenCalled()
  })

  it('ignores the renderer URL outside development', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://example.com')

    openUserDataRelocationWindow({ getProgress: () => null, onRestart: vi.fn() })

    expect(window.loadURL).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
  })

  it('blocks user close during copy and sends progress to the renderer', async () => {
    const onRestart = vi.fn()
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })
    window.webContents.emit('did-finish-load')
    await controller.waitForReady()

    const progress = {
      stage: 'copying' as const,
      from: '/old',
      to: '/new',
      copy: true,
      bytesCopied: 1,
      bytesTotal: 2
    }
    controller.updateProgress(progress)
    window.close()

    expect(window.webContents.send).toHaveBeenCalledWith('ipc-api:event', 'app.user_data_relocation.progress', progress)
    expect(onRestart).not.toHaveBeenCalled()
    expect(controller.hasWindow()).toBe(true)
  })

  it('routes terminal close through the restart callback and unregisters handlers', () => {
    const onRestart = vi.fn()
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })
    controller.updateProgress({
      stage: 'completed',
      from: '/old',
      to: '/new',
      copy: true,
      bytesCopied: 0,
      bytesTotal: 0
    })

    window.close()

    expect(onRestart).toHaveBeenCalledTimes(1)
    expect(ipcRemoveHandlerMock).toHaveBeenCalledWith('ipc-api:request')
  })

  it('keeps the window and restart IpcApi route available when the restart callback throws', async () => {
    const onRestart = vi.fn().mockImplementationOnce(() => {
      throw new Error('failed to clear relocation state')
    })
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    await expect(invoke('app.user_data_relocation.restart')).resolves.toMatchObject({
      ok: false,
      error: { message: 'failed to clear relocation state' }
    })
    expect(controller.hasWindow()).toBe(true)
    expect(window.close).not.toHaveBeenCalled()
    expect(handlers.has('ipc-api:request')).toBe(true)

    await expect(invoke('app.user_data_relocation.restart')).resolves.toEqual({ ok: true, data: undefined })
    expect(onRestart).toHaveBeenCalledTimes(2)
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('serves current progress through the scoped IpcApi route', async () => {
    const progress = {
      stage: 'copying' as const,
      from: '/old',
      to: '/new',
      copy: true,
      bytesCopied: 3,
      bytesTotal: 4
    }
    openUserDataRelocationWindow({ getProgress: () => progress, onRestart: vi.fn() })

    await expect(invoke('app.user_data_relocation.get_progress')).resolves.toEqual({ ok: true, data: progress })
  })

  it('rejects relocation IpcApi requests from an untrusted sender', async () => {
    const onRestart = vi.fn()
    validateSenderMock.mockReturnValue(false)
    openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    await expect(invoke('app.user_data_relocation.restart')).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER' }
    })
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('marks a crashed critical renderer unavailable without interrupting the copy owner', () => {
    const onRestart = vi.fn()
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(controller.isUnavailable()).toBe(true)
    expect(onRestart).not.toHaveBeenCalled()
  })
})
