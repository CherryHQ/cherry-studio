import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Use vi.hoisted() so mock variables are available in hoisted vi.mock() factories
const { mockLogger, mocks } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  mocks: {
    mainWindow: null as {
      isDestroyed: Mock
      webContents: { send: Mock }
    } | null,
    browser: null as
      | (EventEmitter & {
          start: Mock
          stop: Mock
          removeAllListeners: Mock
        })
      | null,
    bonjour: null as {
      find: Mock
      destroy: Mock
    } | null,
    windowManager: null as {
      broadcastToType: Mock
      getWindowsByType: Mock
      getAllWindows: Mock
    } | null
  }
}))

// Mock dependencies before importing the service
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') {
        return { getMainWindow: vi.fn(() => mocks.mainWindow) }
      }
      if (name === 'WindowManager') {
        return mocks.windowManager
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    })
  }
}))

vi.mock('bonjour-service', () => ({
  default: vi.fn(() => mocks.bonjour)
}))

vi.mock('node:net', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createConnection: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'Cherry Studio'),
    getVersion: vi.fn(() => '1.0.0')
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
  }
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

import { LanTransferService } from '../LanTransferService'

function createService(): LanTransferService {
  return new LanTransferService()
}

// =============================================================================
// Discovery Tests
// =============================================================================

describe('LanTransferService - Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock objects
    mocks.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    }
    mocks.windowManager = {
      broadcastToType: vi.fn(),
      getWindowsByType: vi.fn(() => [{ id: 'main-1' }]),
      getAllWindows: vi.fn(() => [])
    }

    mocks.browser = Object.assign(new EventEmitter(), {
      start: vi.fn(),
      stop: vi.fn(),
      removeAllListeners: vi.fn()
    })

    mocks.bonjour = {
      find: vi.fn(() => mocks.browser),
      destroy: vi.fn()
    }
  })

  describe('onInit', () => {
    it('should register IPC handlers without starting discovery', async () => {
      const service = createService()
      await (service as any).onInit()

      // 3 discovery + 4 transfer = 7 IPC handlers
      expect((service as any).ipcHandle).toHaveBeenCalledTimes(7)
      // Discovery should NOT start automatically (lazy start)
      expect(mocks.bonjour!.find).not.toHaveBeenCalled()
      expect(service.getState().isScanning).toBe(false)
    })
  })

  describe('startDiscovery', () => {
    it('should set isScanning to true and start browser', () => {
      const service = createService()

      const state = service.startDiscovery()

      expect(state.isScanning).toBe(true)
      expect(state.lastScanStartedAt).toBeDefined()
      expect(mocks.bonjour!.find).toHaveBeenCalledWith({ type: 'cherrystudio', protocol: 'tcp' })
      expect(mocks.browser!.start).toHaveBeenCalled()
    })

    it('should clear services when resetList is true', () => {
      const service = createService()

      // First, start discovery and add a service
      service.startDiscovery()
      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      expect(service.getState().services).toHaveLength(1)

      // Now restart with resetList
      const state = service.startDiscovery({ resetList: true })

      expect(state.services).toHaveLength(0)
    })

    it('should broadcast state after starting discovery', () => {
      const service = createService()

      service.startDiscovery()

      expect(mocks.windowManager?.broadcastToType).toHaveBeenCalled()
    })

    it('should handle browser.start() error', () => {
      mocks.browser!.start.mockImplementation(() => {
        throw new Error('Failed to start mDNS')
      })

      const service = createService()

      const state = service.startDiscovery()

      expect(state.lastError).toBe('Failed to start mDNS')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('stopDiscovery', () => {
    it('should set isScanning to false and stop browser', () => {
      const service = createService()

      service.startDiscovery()
      const state = service.stopDiscovery()

      expect(state.isScanning).toBe(false)
      expect(mocks.browser!.stop).toHaveBeenCalled()
    })

    it('should handle browser.stop() error gracefully', () => {
      mocks.browser!.stop.mockImplementation(() => {
        throw new Error('Stop failed')
      })

      const service = createService()

      service.startDiscovery()

      // Should not throw
      expect(() => service.stopDiscovery()).not.toThrow()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should broadcast state after stopping', () => {
      const service = createService()

      service.startDiscovery()
      vi.clearAllMocks()

      service.stopDiscovery()

      expect(mocks.windowManager?.broadcastToType).toHaveBeenCalled()
    })
  })

  describe('browser events', () => {
    it('should add service on "up" event', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local',
        type: 'cherrystudio',
        protocol: 'tcp'
      })

      const state = service.getState()
      expect(state.services).toHaveLength(1)
      expect(state.services[0].name).toBe('Test Service')
      expect(state.services[0].port).toBe(12345)
      expect(state.services[0].addresses).toContain('192.168.1.100')
    })

    it('should remove service on "down" event', () => {
      const service = createService()

      service.startDiscovery()

      // Add service
      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      expect(service.getState().services).toHaveLength(1)

      // Remove service
      mocks.browser!.emit('down', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        fqdn: 'test.local'
      })

      expect(service.getState().services).toHaveLength(0)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('removed'))
    })

    it('should set lastError on "error" event', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('error', new Error('Discovery failed'))

      const state = service.getState()
      expect(state.lastError).toBe('Discovery failed')
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error objects in error event', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('error', 'String error message')

      const state = service.getState()
      expect(state.lastError).toBe('String error message')
    })
  })

  describe('getState', () => {
    it('should return sorted services by name', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Zebra Service',
        host: 'host1',
        port: 1001,
        addresses: ['192.168.1.1']
      })

      mocks.browser!.emit('up', {
        name: 'Alpha Service',
        host: 'host2',
        port: 1002,
        addresses: ['192.168.1.2']
      })

      const state = service.getState()
      expect(state.services[0].name).toBe('Alpha Service')
      expect(state.services[1].name).toBe('Zebra Service')
    })

    it('should include all state properties', () => {
      const service = createService()

      service.startDiscovery()

      const state = service.getState()

      expect(state).toHaveProperty('services')
      expect(state).toHaveProperty('isScanning')
      expect(state).toHaveProperty('lastScanStartedAt')
      expect(state).toHaveProperty('lastUpdatedAt')
    })
  })

  describe('getPeerById', () => {
    it('should return peer when exists', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      const services = service.getState().services
      const peer = service.getPeerById(services[0].id)

      expect(peer).toBeDefined()
      expect(peer?.name).toBe('Test Service')
    })

    it('should return undefined when peer does not exist', () => {
      const service = createService()

      const peer = service.getPeerById('non-existent-id')

      expect(peer).toBeUndefined()
    })
  })

  describe('normalizeService', () => {
    it('should deduplicate addresses', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100', '192.168.1.100', '10.0.0.1'],
        referer: { address: '192.168.1.100' }
      })

      const services = service.getState().services
      expect(services[0].addresses).toHaveLength(2)
      expect(services[0].addresses).toContain('192.168.1.100')
      expect(services[0].addresses).toContain('10.0.0.1')
    })

    it('should filter empty addresses', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100', '', null as any]
      })

      const services = service.getState().services
      expect(services[0].addresses).toEqual(['192.168.1.100'])
    })

    it('should convert txt null/undefined values to empty strings', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        txt: {
          version: '1.0',
          nullValue: null,
          undefinedValue: undefined,
          numberValue: 42
        }
      })

      const services = service.getState().services
      expect(services[0].txt).toEqual({
        version: '1.0',
        nullValue: '',
        undefinedValue: '',
        numberValue: '42'
      })
    })

    it('should not include txt when empty', () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        txt: {}
      })

      const services = service.getState().services
      expect(services[0].txt).toBeUndefined()
    })
  })

  describe('onStop', () => {
    it('should clean up all resources', async () => {
      const service = createService()

      service.startDiscovery()

      mocks.browser!.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100']
      })

      await (service as any).onStop()

      expect(service.getState().services).toHaveLength(0)
      expect(service.getState().isScanning).toBe(false)
      expect(mocks.browser!.removeAllListeners).toHaveBeenCalled()
      expect(mocks.bonjour!.destroy).toHaveBeenCalled()
    })

    it('should handle bonjour.destroy() error gracefully', async () => {
      mocks.bonjour!.destroy.mockImplementation(() => {
        throw new Error('Destroy failed')
      })

      const service = createService()

      service.startDiscovery()

      // Should not throw
      await expect((service as any).onStop()).resolves.not.toThrow()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should be safe to call multiple times', async () => {
      const service = createService()

      service.startDiscovery()

      await (service as any).onStop()
      await expect((service as any).onStop()).resolves.not.toThrow()
    })
  })

  describe('broadcastState', () => {
    it('should not throw when main window is null', () => {
      // Service now broadcasts via WindowManager which is always present;
      // a missing main window is WindowManager's concern (it silently skips).
      mocks.windowManager!.getWindowsByType = vi.fn(() => [])

      const service = createService()

      // Should not throw
      expect(() => service.startDiscovery()).not.toThrow()
    })

    it('should not throw when main window is destroyed', () => {
      // WindowManager.broadcastToType internally skips destroyed windows;
      // service never inspects BrowserWindow.isDestroyed() anymore.
      const service = createService()

      // Should not throw
      expect(() => service.startDiscovery()).not.toThrow()
    })
  })

  describe('restartBrowser', () => {
    it('should destroy old bonjour instance to prevent socket leaks', () => {
      const service = createService()

      // First start
      service.startDiscovery()
      expect(mocks.bonjour!.destroy).not.toHaveBeenCalled()

      // Restart - should destroy old instance
      service.startDiscovery()
      expect(mocks.bonjour!.destroy).toHaveBeenCalled()
    })

    it('should remove all listeners from old browser', () => {
      const service = createService()

      service.startDiscovery()
      service.startDiscovery()

      expect(mocks.browser!.removeAllListeners).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Transfer Tests
// =============================================================================

describe('LanTransferService - Transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    }

    mocks.browser = Object.assign(new EventEmitter(), {
      start: vi.fn(),
      stop: vi.fn(),
      removeAllListeners: vi.fn()
    })

    mocks.bonjour = {
      find: vi.fn(() => mocks.browser),
      destroy: vi.fn()
    }
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('connectAndHandshake - validation', () => {
    it('should throw error when peer is not found', async () => {
      const service = createService()
      await (service as any).onInit()

      await expect(
        service.connectAndHandshake({
          peerId: 'non-existent'
        })
      ).rejects.toThrow('Selected LAN peer is no longer available')
    })

    it('should throw error when peer has no port', async () => {
      const service = createService()
      await (service as any).onInit()
      service.startDiscovery()

      // Add a peer without port via discovery
      mocks.browser!.emit('up', {
        name: 'Test Peer',
        host: 'localhost',
        addresses: ['192.168.1.100']
      })

      const peerId = service.getState().services[0].id

      await expect(service.connectAndHandshake({ peerId })).rejects.toThrow('Selected peer does not expose a TCP port')
    })

    it('should throw error when no reachable host', async () => {
      const service = createService()
      await (service as any).onInit()
      service.startDiscovery()

      // Add a peer with port but no addresses
      mocks.browser!.emit('up', {
        name: 'Test Peer',
        port: 12345,
        addresses: []
      })

      const peerId = service.getState().services[0].id

      await expect(service.connectAndHandshake({ peerId })).rejects.toThrow(
        'Unable to resolve a reachable host for the peer'
      )
    })
  })

  describe('cancelTransfer', () => {
    it('should not throw when no active transfer', async () => {
      const service = createService()
      await (service as any).onInit()

      // Should not throw, just log warning
      expect(() => service.cancelTransfer()).not.toThrow()
    })
  })

  describe('sendFile', () => {
    it('should throw error when not connected', async () => {
      const service = createService()
      await (service as any).onInit()

      await expect(service.sendFile('/path/to/file.zip')).rejects.toThrow(
        'No active connection. Please connect to a peer first.'
      )
    })
  })

  describe('HANDSHAKE_PROTOCOL_VERSION', () => {
    it('should export protocol version', async () => {
      const { HANDSHAKE_PROTOCOL_VERSION } = await import('../LanTransferService')

      expect(HANDSHAKE_PROTOCOL_VERSION).toBe('1')
    })
  })
})
