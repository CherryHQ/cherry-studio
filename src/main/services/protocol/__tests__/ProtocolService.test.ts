import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock, loggerMock, handlersMock, windowManagerMock, mainWindowServiceMock } = vi.hoisted(() => {
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
    handleMcpProtocolUrl: vi.fn(),
    handleNavigateProtocolUrl: vi.fn(),
    handleProvidersProtocolUrl: vi.fn()
  }
  const windowManagerMock = {
    broadcast: vi.fn()
  }
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  return { appMock, loggerMock, handlersMock, windowManagerMock, mainWindowServiceMock }
})

vi.mock('electron', () => ({ app: appMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'MainWindowService') return mainWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    },
    getPath: (key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`)
  }
}))

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

vi.mock('../handlers/mcpInstall', () => ({
  handleMcpProtocolUrl: handlersMock.handleMcpProtocolUrl
}))

vi.mock('../handlers/navigate', () => ({
  handleNavigateProtocolUrl: handlersMock.handleNavigateProtocolUrl
}))

vi.mock('../handlers/providersImport', () => ({
  handleProvidersProtocolUrl: handlersMock.handleProvidersProtocolUrl
}))

import { ProtocolService } from '../ProtocolService'

describe('ProtocolService', () => {
  let service: ProtocolService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ProtocolService()
  })

  it('logs malformed protocol URLs instead of throwing', () => {
    expect(() => (service as any).handleProtocolUrl('not a url')).not.toThrow()

    expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle protocol URL', expect.any(TypeError))
  })

  it('logs asynchronous providers handler failures', async () => {
    const error = new Error('failed')
    handlersMock.handleProvidersProtocolUrl.mockRejectedValueOnce(error)

    ;(service as any).handleProtocolUrl('cherrystudio://providers/api-keys?v=1&data=abc')

    await vi.waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith('Failed to handle providers protocol URL', error)
    })
  })

  it('broadcasts unknown protocol hosts to all windows', () => {
    ;(service as any).handleProtocolUrl('cherrystudio://unknown/path?foo=bar')

    expect(windowManagerMock.broadcast).toHaveBeenCalledWith('protocol-data', {
      url: 'cherrystudio://unknown/path?foo=bar',
      params: { foo: 'bar' }
    })
  })

  describe('second-instance handler', () => {
    function getSecondInstanceHandler() {
      const call = appMock.on.mock.calls.find(([event]: [string]) => event === 'second-instance')
      if (!call) throw new Error('second-instance listener not registered')
      return call[1] as (event: unknown, argv: string[]) => void
    }

    it('dispatches the URL when argv carries a cherrystudio:// deep link', async () => {
      await (service as any).onInit()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.', 'cherrystudio://oauth/callback?code=abc'])

      expect(mainWindowServiceMock.showMainWindow).not.toHaveBeenCalled()
      expect(windowManagerMock.broadcast).toHaveBeenCalledWith('protocol-data', {
        url: 'cherrystudio://oauth/callback?code=abc',
        params: { code: 'abc' }
      })
    })

    it('surfaces the main window when argv has no protocol URL', async () => {
      await (service as any).onInit()
      const handler = getSecondInstanceHandler()

      handler({}, ['/path/to/electron', '.'])

      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
      expect(windowManagerMock.broadcast).not.toHaveBeenCalled()
    })
  })
})
