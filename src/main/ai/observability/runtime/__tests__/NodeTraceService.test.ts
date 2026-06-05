import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, windowManagerMock } = vi.hoisted(() => {
  type WindowInfoMock = { id: string }
  type TraceWindowMock = { isDestroyed: () => boolean; setTitle: (title: string) => void }
  const windowManagerMock = {
    open: vi.fn(() => 'trace-window-id'),
    getWindow: vi.fn<(id: string) => TraceWindowMock | undefined>(() => undefined),
    getWindowsByType: vi.fn<() => WindowInfoMock[]>(() => [])
  }
  const preferenceServiceMock = {
    get: vi.fn(() => false)
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'PreferenceService') return preferenceServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, windowManagerMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    public isActivated = true
    protected ipcHandle = vi.fn()
    protected registerDisposable = vi.fn(<T>(disposable: T) => disposable)
  }
  return { ...actual, BaseService: StubBase }
})

import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'

import { NodeTraceService } from '../NodeTraceService'

function getIpcHandleHandler(service: NodeTraceService, channel: string) {
  const call = (service as any).ipcHandle.mock.calls.find(
    ([registeredChannel]: [string]) => registeredChannel === channel
  )
  if (!call) throw new Error(`ipcHandle handler not registered for channel: ${channel}`)
  return call[1]
}

describe('NodeTraceService', () => {
  let service: NodeTraceService

  beforeEach(async () => {
    vi.clearAllMocks()
    windowManagerMock.open.mockReturnValue('trace-window-id')
    windowManagerMock.getWindow.mockReturnValue(undefined)
    windowManagerMock.getWindowsByType.mockReturnValue([])
    service = new NodeTraceService()
    await (service as any).onInit()
  })

  it('opens trace windows through WindowManager init data', () => {
    const handler = getIpcHandleHandler(service, IpcChannel.TRACE_OPEN_WINDOW)

    handler({}, 'topic-a', 'trace-a', true, 'model-a')

    expect(windowManagerMock.open).toHaveBeenCalledWith(WindowType.Trace, {
      initData: {
        topicId: 'topic-a',
        traceId: 'trace-a',
        modelName: 'model-a'
      }
    })
  })

  it('does not create a trace window for passive auto-open when no trace window exists', () => {
    const handler = getIpcHandleHandler(service, IpcChannel.TRACE_OPEN_WINDOW)

    handler({}, 'topic-a', 'trace-a', false)

    expect(windowManagerMock.open).not.toHaveBeenCalled()
  })

  it('reuses an existing trace singleton for passive auto-open', () => {
    windowManagerMock.getWindowsByType.mockReturnValue([{ id: 'trace-window-id' }])
    const handler = getIpcHandleHandler(service, IpcChannel.TRACE_OPEN_WINDOW)

    handler({}, 'topic-a', 'trace-a', false)

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Trace,
      expect.objectContaining({
        initData: expect.objectContaining({
          topicId: 'topic-a',
          traceId: 'trace-a'
        })
      })
    )
  })

  it('updates the native title on managed trace windows', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      setTitle: vi.fn()
    }
    windowManagerMock.getWindowsByType.mockReturnValue([{ id: 'trace-window-id' }])
    windowManagerMock.getWindow.mockReturnValue(window)
    const handler = getIpcHandleHandler(service, IpcChannel.TRACE_SET_TITLE)

    handler({}, 'Trace')

    expect(window.setTitle).toHaveBeenCalledWith('Trace')
  })
})
