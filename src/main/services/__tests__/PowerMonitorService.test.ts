import { beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted() so mock variables are available in hoisted vi.mock() factories
const {
  platformMock,
  mockPowerMonitorOn,
  mockPowerMonitorRemoveListener,
  mockWindowDestroy,
  mockWindowIsDestroyed,
  mockGetNativeWindowHandle,
  mockWhenReady,
  mockShutdownHandlerOn,
  mockSetWindowHandle,
  mockReleaseShutdown
} = vi.hoisted(() => ({
  platformMock: { isMac: true, isWin: false, isLinux: false },
  mockPowerMonitorOn: vi.fn(),
  mockPowerMonitorRemoveListener: vi.fn(),
  mockWindowDestroy: vi.fn(),
  mockWindowIsDestroyed: vi.fn().mockReturnValue(false),
  mockGetNativeWindowHandle: vi.fn().mockReturnValue(Buffer.alloc(0)),
  mockWhenReady: vi.fn().mockResolvedValue(undefined),
  mockShutdownHandlerOn: vi.fn(),
  mockSetWindowHandle: vi.fn(),
  mockReleaseShutdown: vi.fn()
}))

vi.mock('@main/constant', () => platformMock)

vi.mock('electron', () => ({
  app: { whenReady: mockWhenReady },
  powerMonitor: {
    on: mockPowerMonitorOn,
    removeListener: mockPowerMonitorRemoveListener
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    destroy: mockWindowDestroy,
    isDestroyed: mockWindowIsDestroyed,
    getNativeWindowHandle: mockGetNativeWindowHandle
  }))
}))

vi.mock('@paymoapp/electron-shutdown-handler', () => ({
  default: {
    on: mockShutdownHandlerOn,
    setWindowHandle: mockSetWindowHandle,
    releaseShutdown: mockReleaseShutdown
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    _disposables: { dispose: () => void }[] = []
    registerDisposable(disposableOrFn: any) {
      const disposable = typeof disposableOrFn === 'function' ? { dispose: disposableOrFn } : disposableOrFn
      this._disposables.push(disposable)
      return disposable
    }
    _cleanupDisposables() {
      for (const d of this._disposables) d.dispose()
      this._disposables = []
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

import { PowerMonitorService } from '../PowerMonitorService'

function createService(): PowerMonitorService {
  return new PowerMonitorService()
}

describe('PowerMonitorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformMock.isMac = true
    platformMock.isWin = false
    platformMock.isLinux = false
  })

  describe('onInit - macOS/Linux', () => {
    it('should register powerMonitor shutdown listener on macOS', async () => {
      const service = createService()
      await (service as any).onInit()

      expect(mockPowerMonitorOn).toHaveBeenCalledWith('shutdown', expect.any(Function))
    })

    it('should register powerMonitor shutdown listener on Linux', async () => {
      platformMock.isMac = false
      platformMock.isLinux = true

      const service = createService()
      await (service as any).onInit()

      expect(mockPowerMonitorOn).toHaveBeenCalledWith('shutdown', expect.any(Function))
    })

    it('should register cleanup disposable for shutdown listener', async () => {
      const service = createService()
      await (service as any).onInit()

      expect((service as any)._disposables.length).toBeGreaterThan(0)
    })
  })

  describe('onInit - Windows', () => {
    beforeEach(() => {
      platformMock.isMac = false
      platformMock.isWin = true
    })

    it('should await app.whenReady() before creating BrowserWindow', async () => {
      const service = createService()
      await (service as any).onInit()

      expect(mockWhenReady).toHaveBeenCalled()
    })

    it('should create hidden BrowserWindow and register shutdown handler', async () => {
      const service = createService()
      await (service as any).onInit()

      expect(mockSetWindowHandle).toHaveBeenCalled()
      expect(mockShutdownHandlerOn).toHaveBeenCalledWith('shutdown', expect.any(Function))
      expect((service as any)._disposables.length).toBeGreaterThan(0)
    })
  })

  describe('registerShutdownHandler', () => {
    it('should add handler to the list', () => {
      const service = createService()
      const handler = vi.fn()

      service.registerShutdownHandler(handler)

      expect((service as any).shutdownHandlers).toHaveLength(1)
      expect((service as any).shutdownHandlers[0]).toBe(handler)
    })

    it('should support multiple handlers', () => {
      const service = createService()

      service.registerShutdownHandler(vi.fn())
      service.registerShutdownHandler(vi.fn())
      service.registerShutdownHandler(vi.fn())

      expect((service as any).shutdownHandlers).toHaveLength(3)
    })
  })

  describe('executeShutdownHandlers', () => {
    it('should execute all registered handlers on shutdown (macOS)', async () => {
      const service = createService()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      service.registerShutdownHandler(handler1)
      service.registerShutdownHandler(handler2)
      await (service as any).onInit()

      const shutdownCallback = mockPowerMonitorOn.mock.calls[0][1]
      await shutdownCallback()

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should continue executing handlers even if one throws', async () => {
      const service = createService()
      const failingHandler = vi.fn().mockRejectedValue(new Error('fail'))
      const successHandler = vi.fn()

      service.registerShutdownHandler(failingHandler)
      service.registerShutdownHandler(successHandler)
      await (service as any).onInit()

      const shutdownCallback = mockPowerMonitorOn.mock.calls[0][1]
      await shutdownCallback()

      expect(failingHandler).toHaveBeenCalled()
      expect(successHandler).toHaveBeenCalled()
    })
  })

  describe('onStop / disposable cleanup', () => {
    it('should remove powerMonitor listener on macOS/Linux via disposable', async () => {
      const service = createService()
      await (service as any).onInit()

      ;(service as any)._cleanupDisposables()

      expect(mockPowerMonitorRemoveListener).toHaveBeenCalledWith('shutdown', expect.any(Function))
    })

    it('should destroy BrowserWindow on Windows via disposable', async () => {
      platformMock.isMac = false
      platformMock.isWin = true

      const service = createService()
      await (service as any).onInit()

      ;(service as any)._cleanupDisposables()

      expect(mockWindowDestroy).toHaveBeenCalled()
    })

    it('should not destroy already-destroyed window on Windows', async () => {
      platformMock.isMac = false
      platformMock.isWin = true
      mockWindowIsDestroyed.mockReturnValue(true)

      const service = createService()
      await (service as any).onInit()

      ;(service as any)._cleanupDisposables()

      expect(mockWindowDestroy).not.toHaveBeenCalled()
    })

    it('should clear shutdown handlers', async () => {
      const service = createService()
      service.registerShutdownHandler(vi.fn())
      service.registerShutdownHandler(vi.fn())

      await (service as any).onInit()
      await (service as any).onStop()

      expect((service as any).shutdownHandlers).toHaveLength(0)
    })
  })
})
