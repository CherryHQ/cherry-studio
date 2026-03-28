import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPeerById } = vi.hoisted(() => ({
  mockGetPeerById: vi.fn()
}))

// Mock dependencies before importing the service
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

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'WindowService') {
        return {
          getMainWindow: vi.fn(() => ({
            isDestroyed: () => false,
            webContents: { send: vi.fn() }
          }))
        }
      }
      if (name === 'LocalTransferService') {
        return { getPeerById: mockGetPeerById }
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    })
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

async function createService() {
  const { LanTransferClientService } = await import('../LanTransferClientService')
  const service = new LanTransferClientService()
  // Manually invoke the init logic since lifecycle is mocked
  await (service as unknown as { onInit(): Promise<void> }).onInit()
  return service
}

describe('LanTransferClientService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('connectAndHandshake - validation', () => {
    it('should throw error when peer is not found', async () => {
      mockGetPeerById.mockReturnValue(undefined)

      const service = await createService()

      await expect(
        service.connectAndHandshake({
          peerId: 'non-existent'
        })
      ).rejects.toThrow('Selected LAN peer is no longer available')
    })

    it('should throw error when peer has no port', async () => {
      mockGetPeerById.mockReturnValue({
        id: 'test-peer',
        name: 'Test Peer',
        addresses: ['192.168.1.100'],
        updatedAt: Date.now()
      })

      const service = await createService()

      await expect(
        service.connectAndHandshake({
          peerId: 'test-peer'
        })
      ).rejects.toThrow('Selected peer does not expose a TCP port')
    })

    it('should throw error when no reachable host', async () => {
      mockGetPeerById.mockReturnValue({
        id: 'test-peer',
        name: 'Test Peer',
        port: 12345,
        addresses: [],
        updatedAt: Date.now()
      })

      const service = await createService()

      await expect(
        service.connectAndHandshake({
          peerId: 'test-peer'
        })
      ).rejects.toThrow('Unable to resolve a reachable host for the peer')
    })
  })

  describe('cancelTransfer', () => {
    it('should not throw when no active transfer', async () => {
      const service = await createService()

      // Should not throw, just log warning
      expect(() => service.cancelTransfer()).not.toThrow()
    })
  })

  describe('onStop', () => {
    it('should clean up resources without throwing', async () => {
      const service = await createService()

      // Should not throw
      await expect((service as unknown as { onStop(): Promise<void> }).onStop()).resolves.toBeUndefined()
    })
  })

  describe('sendFile', () => {
    it('should throw error when not connected', async () => {
      const service = await createService()

      await expect(service.sendFile('/path/to/file.zip')).rejects.toThrow(
        'No active connection. Please connect to a peer first.'
      )
    })
  })

  describe('HANDSHAKE_PROTOCOL_VERSION', () => {
    it('should export protocol version', async () => {
      const { HANDSHAKE_PROTOCOL_VERSION } = await import('../LanTransferClientService')

      expect(HANDSHAKE_PROTOCOL_VERSION).toBe('1')
    })
  })
})
