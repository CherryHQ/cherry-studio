import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  }
}))

vi.mock('../../LocalTransferService', () => ({
  localTransferService: {
    getPeerById: vi.fn()
  }
}))

vi.mock('../../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({
      isDestroyed: () => false,
      webContents: {
        send: vi.fn()
      }
    }))
  }
}))

// Import after mocks
import { localTransferService } from '../../LocalTransferService'

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
      vi.mocked(localTransferService.getPeerById).mockReturnValue(undefined)

      const { lanTransferClientService } = await import('../LanTransferClientService')

      await expect(
        lanTransferClientService.connectAndHandshake({
          peerId: 'non-existent'
        })
      ).rejects.toThrow('Selected LAN peer is no longer available')
    })

    it('should throw error when peer has no port', async () => {
      vi.mocked(localTransferService.getPeerById).mockReturnValue({
        id: 'test-peer',
        name: 'Test Peer',
        addresses: ['192.168.1.100'],
        updatedAt: Date.now()
      })

      const { lanTransferClientService } = await import('../LanTransferClientService')

      await expect(
        lanTransferClientService.connectAndHandshake({
          peerId: 'test-peer'
        })
      ).rejects.toThrow('Selected peer does not expose a TCP port')
    })

    it('should throw error when no reachable host', async () => {
      vi.mocked(localTransferService.getPeerById).mockReturnValue({
        id: 'test-peer',
        name: 'Test Peer',
        port: 12345,
        addresses: [],
        updatedAt: Date.now()
      })

      const { lanTransferClientService } = await import('../LanTransferClientService')

      await expect(
        lanTransferClientService.connectAndHandshake({
          peerId: 'test-peer'
        })
      ).rejects.toThrow('Unable to resolve a reachable host for the peer')
    })
  })

  describe('cancelTransfer', () => {
    it('should not throw when no active transfer', async () => {
      const { lanTransferClientService } = await import('../LanTransferClientService')

      // Should not throw, just log warning
      expect(() => lanTransferClientService.cancelTransfer()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('should clean up resources without throwing', async () => {
      const { lanTransferClientService } = await import('../LanTransferClientService')

      // Should not throw
      expect(() => lanTransferClientService.dispose()).not.toThrow()
    })
  })

  describe('sendFile', () => {
    it('should throw error when not connected', async () => {
      const { lanTransferClientService } = await import('../LanTransferClientService')

      await expect(lanTransferClientService.sendFile('/path/to/file.zip')).rejects.toThrow(
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
