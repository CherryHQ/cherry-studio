import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { browserWindowMock, ipcHandleMock, ipcRemoveHandlerMock } = vi.hoisted(() => ({
  browserWindowMock: vi.fn(),
  ipcHandleMock: vi.fn(),
  ipcRemoveHandlerMock: vi.fn()
}))

vi.mock('@main/core/platform', () => ({ isMac: false }))
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
let handlers: Map<string, () => unknown>

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
  handlers = new Map()
  ipcHandleMock.mockImplementation((channel: string, handler: () => unknown) => handlers.set(channel, handler))
  ipcRemoveHandlerMock.mockImplementation((channel: string) => handlers.delete(channel))
  window = makeWindow()
  browserWindowMock.mockReturnValue(window)
})

describe('relocationWindowService', () => {
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

    expect(window.webContents.send).toHaveBeenCalledWith('relocation:progress', progress)
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
    expect(ipcRemoveHandlerMock).toHaveBeenCalledWith('relocation:get-progress')
    expect(ipcRemoveHandlerMock).toHaveBeenCalledWith('relocation:restart')
  })

  it('marks a crashed critical renderer unavailable without interrupting the copy owner', () => {
    const onRestart = vi.fn()
    const controller = openUserDataRelocationWindow({ getProgress: () => null, onRestart })

    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(controller.isUnavailable()).toBe(true)
    expect(onRestart).not.toHaveBeenCalled()
  })
})
