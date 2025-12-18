import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Create mock objects before vi.mock calls
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

let mockMainWindow: {
  isDestroyed: Mock
  webContents: { send: Mock }
} | null = null

let mockBrowser: EventEmitter & {
  start: Mock
  stop: Mock
  removeAllListeners: Mock
}

let mockBonjour: {
  find: Mock
  destroy: Mock
}

// Mock dependencies before importing the service
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => mockMainWindow)
  }
}))

vi.mock('bonjour-service', () => ({
  default: vi.fn(() => mockBonjour)
}))

describe('LocalTransferService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Reset mock objects
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    }

    mockBrowser = Object.assign(new EventEmitter(), {
      start: vi.fn(),
      stop: vi.fn(),
      removeAllListeners: vi.fn()
    })

    mockBonjour = {
      find: vi.fn(() => mockBrowser),
      destroy: vi.fn()
    }
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('startDiscovery', () => {
    it('should set isScanning to true and start browser', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      const state = localTransferService.startDiscovery()

      expect(state.isScanning).toBe(true)
      expect(state.lastScanStartedAt).toBeDefined()
      expect(mockBonjour.find).toHaveBeenCalledWith({ type: 'cherrystudio', protocol: 'tcp' })
      expect(mockBrowser.start).toHaveBeenCalled()
    })

    it('should clear services when resetList is true', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      // First, start discovery and add a service
      localTransferService.startDiscovery()
      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      expect(localTransferService.getState().services).toHaveLength(1)

      // Now restart with resetList
      const state = localTransferService.startDiscovery({ resetList: true })

      expect(state.services).toHaveLength(0)
    })

    it('should broadcast state after starting discovery', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      expect(mockMainWindow?.webContents.send).toHaveBeenCalled()
    })

    it('should handle browser.start() error', async () => {
      mockBrowser.start.mockImplementation(() => {
        throw new Error('Failed to start mDNS')
      })

      const { localTransferService } = await import('../LocalTransferService')

      const state = localTransferService.startDiscovery()

      expect(state.lastError).toBe('Failed to start mDNS')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('stopDiscovery', () => {
    it('should set isScanning to false and stop browser', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()
      const state = localTransferService.stopDiscovery()

      expect(state.isScanning).toBe(false)
      expect(mockBrowser.stop).toHaveBeenCalled()
    })

    it('should handle browser.stop() error gracefully', async () => {
      mockBrowser.stop.mockImplementation(() => {
        throw new Error('Stop failed')
      })

      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      // Should not throw
      expect(() => localTransferService.stopDiscovery()).not.toThrow()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should broadcast state after stopping', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()
      vi.clearAllMocks()

      localTransferService.stopDiscovery()

      expect(mockMainWindow?.webContents.send).toHaveBeenCalled()
    })
  })

  describe('browser events', () => {
    it('should add service on "up" event', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local',
        type: 'cherrystudio',
        protocol: 'tcp'
      })

      const state = localTransferService.getState()
      expect(state.services).toHaveLength(1)
      expect(state.services[0].name).toBe('Test Service')
      expect(state.services[0].port).toBe(12345)
      expect(state.services[0].addresses).toContain('192.168.1.100')
    })

    it('should remove service on "down" event', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      // Add service
      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      expect(localTransferService.getState().services).toHaveLength(1)

      // Remove service
      mockBrowser.emit('down', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        fqdn: 'test.local'
      })

      expect(localTransferService.getState().services).toHaveLength(0)
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('removed'))
    })

    it('should set lastError on "error" event', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('error', new Error('Discovery failed'))

      const state = localTransferService.getState()
      expect(state.lastError).toBe('Discovery failed')
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error objects in error event', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('error', 'String error message')

      const state = localTransferService.getState()
      expect(state.lastError).toBe('String error message')
    })
  })

  describe('getState', () => {
    it('should return sorted services by name', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Zebra Service',
        host: 'host1',
        port: 1001,
        addresses: ['192.168.1.1']
      })

      mockBrowser.emit('up', {
        name: 'Alpha Service',
        host: 'host2',
        port: 1002,
        addresses: ['192.168.1.2']
      })

      const state = localTransferService.getState()
      expect(state.services[0].name).toBe('Alpha Service')
      expect(state.services[1].name).toBe('Zebra Service')
    })

    it('should include all state properties', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      const state = localTransferService.getState()

      expect(state).toHaveProperty('services')
      expect(state).toHaveProperty('isScanning')
      expect(state).toHaveProperty('lastScanStartedAt')
      expect(state).toHaveProperty('lastUpdatedAt')
    })
  })

  describe('getPeerById', () => {
    it('should return peer when exists', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        fqdn: 'test.local'
      })

      const services = localTransferService.getState().services
      const peer = localTransferService.getPeerById(services[0].id)

      expect(peer).toBeDefined()
      expect(peer?.name).toBe('Test Service')
    })

    it('should return undefined when peer does not exist', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      const peer = localTransferService.getPeerById('non-existent-id')

      expect(peer).toBeUndefined()
    })
  })

  describe('normalizeService', () => {
    it('should deduplicate addresses', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100', '192.168.1.100', '10.0.0.1'],
        referer: { address: '192.168.1.100' }
      })

      const services = localTransferService.getState().services
      expect(services[0].addresses).toHaveLength(2)
      expect(services[0].addresses).toContain('192.168.1.100')
      expect(services[0].addresses).toContain('10.0.0.1')
    })

    it('should filter empty addresses', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100', '', null as any]
      })

      const services = localTransferService.getState().services
      expect(services[0].addresses).toEqual(['192.168.1.100'])
    })

    it('should convert txt null/undefined values to empty strings', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
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

      const services = localTransferService.getState().services
      expect(services[0].txt).toEqual({
        version: '1.0',
        nullValue: '',
        undefinedValue: '',
        numberValue: '42'
      })
    })

    it('should not include txt when empty', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100'],
        txt: {}
      })

      const services = localTransferService.getState().services
      expect(services[0].txt).toBeUndefined()
    })
  })

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      mockBrowser.emit('up', {
        name: 'Test Service',
        host: 'localhost',
        port: 12345,
        addresses: ['192.168.1.100']
      })

      localTransferService.dispose()

      expect(localTransferService.getState().services).toHaveLength(0)
      expect(localTransferService.getState().isScanning).toBe(false)
      expect(mockBrowser.removeAllListeners).toHaveBeenCalled()
      expect(mockBonjour.destroy).toHaveBeenCalled()
    })

    it('should handle bonjour.destroy() error gracefully', async () => {
      mockBonjour.destroy.mockImplementation(() => {
        throw new Error('Destroy failed')
      })

      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      // Should not throw
      expect(() => localTransferService.dispose()).not.toThrow()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should be safe to call multiple times', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()

      expect(() => {
        localTransferService.dispose()
        localTransferService.dispose()
      }).not.toThrow()
    })
  })

  describe('broadcastState', () => {
    it('should not throw when main window is null', async () => {
      mockMainWindow = null

      const { localTransferService } = await import('../LocalTransferService')

      // Should not throw
      expect(() => localTransferService.startDiscovery()).not.toThrow()
    })

    it('should not throw when main window is destroyed', async () => {
      mockMainWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: { send: vi.fn() }
      }

      const { localTransferService } = await import('../LocalTransferService')

      // Should not throw
      expect(() => localTransferService.startDiscovery()).not.toThrow()
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('restartBrowser', () => {
    it('should destroy old bonjour instance to prevent socket leaks', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      // First start
      localTransferService.startDiscovery()
      expect(mockBonjour.destroy).not.toHaveBeenCalled()

      // Restart - should destroy old instance
      localTransferService.startDiscovery()
      expect(mockBonjour.destroy).toHaveBeenCalled()
    })

    it('should remove all listeners from old browser', async () => {
      const { localTransferService } = await import('../LocalTransferService')

      localTransferService.startDiscovery()
      localTransferService.startDiscovery()

      expect(mockBrowser.removeAllListeners).toHaveBeenCalled()
    })
  })
})
