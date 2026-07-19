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
vi.mock('@main/core/security/validateSender', () => ({ validateSender: validateSenderMock }))
vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  ipcMain: { handle: ipcHandleMock, removeHandler: ipcRemoveHandlerMock }
}))

import { UserDataRelocationIpcChannels } from '@shared/types/userDataRelocation'

import { openUserDataRelocationWindow } from '../window'

interface MockWindow extends EventEmitter {
  webContents: EventEmitter & { send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

let window: MockWindow
let handlers: Map<string, (event: unknown) => unknown>

function invoke(channel: string): unknown {
  return handlers.get(channel)?.({})
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
  ipcHandleMock.mockImplementation((channel: string, handler: (event: unknown) => unknown) =>
    handlers.set(channel, handler)
  )
  ipcRemoveHandlerMock.mockImplementation((channel: string) => handlers.delete(channel))
  window = makeWindow()
  browserWindowMock.mockReturnValue(window)
})

describe('userDataRelocation window', () => {
  it('does not silently replace an existing handler on its channels', () => {
    ipcHandleMock.mockImplementationOnce(() => {
      throw new Error('Attempted to register a second handler')
    })

    expect(() => openUserDataRelocationWindow({ getProgress: () => null, onRestart: vi.fn() })).toThrow(
      'Attempted to register a second handler'
    )
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

    expect(window.webContents.send).toHaveBeenCalledWith(UserDataRelocationIpcChannels.Progress, progress)
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
    expect(ipcRemoveHandlerMock).toHaveBeenCalledWith(UserDataRelocationIpcChannels.GetProgress)
    expect(ipcRemoveHandlerMock).toHaveBeenCalledWith(UserDataRelocationIpcChannels.Restart)
  })

  it('keeps the window and restart channel available when the restart callback throws', () => {
    const onRestart = vi.fn().mockImplementationOnce(() => {
      throw new Error('failed to clear relocation state')
    })
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    expect(() => invoke(UserDataRelocationIpcChannels.Restart)).toThrow('failed to clear relocation state')
    expect(controller.hasWindow()).toBe(true)
    expect(window.close).not.toHaveBeenCalled()
    expect(handlers.has(UserDataRelocationIpcChannels.Restart)).toBe(true)

    expect(invoke(UserDataRelocationIpcChannels.Restart)).toBeUndefined()
    expect(onRestart).toHaveBeenCalledTimes(2)
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('serves current progress through its dedicated channel', () => {
    const progress = {
      stage: 'copying' as const,
      from: '/old',
      to: '/new',
      copy: true,
      bytesCopied: 3,
      bytesTotal: 4
    }
    openUserDataRelocationWindow({ getProgress: () => progress, onRestart: vi.fn() })

    expect(invoke(UserDataRelocationIpcChannels.GetProgress)).toEqual(progress)
  })

  it('rejects relocation IPC requests from an untrusted sender', () => {
    const onRestart = vi.fn()
    validateSenderMock.mockReturnValue(false)
    openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    expect(() => invoke(UserDataRelocationIpcChannels.Restart)).toThrow('untrusted sender')
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
