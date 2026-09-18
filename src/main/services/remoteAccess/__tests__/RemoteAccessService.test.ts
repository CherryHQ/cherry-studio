import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const { loadIdentity, gateway } = vi.hoisted(() => ({
  loadIdentity: vi.fn(),
  gateway: {
    serving: true,
    listeners: new Set<() => void>(),
    setServing(serving: boolean) {
      this.serving = serving
      for (const listener of this.listeners) listener()
    }
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ApiGatewayService: {
      isLanServing: () => gateway.serving,
      onLanServingChanged: (listener: () => void) => {
        gateway.listeners.add(listener)
        return { dispose: () => gateway.listeners.delete(listener) }
      }
    }
  } as never)
})
vi.mock('../identity', () => ({ loadIdentity }))
vi.mock('../agentAccess', () => ({ assertWritable: vi.fn() }))
vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: { onDeleted: () => ({ dispose: () => {} }), findByTokenHash: () => undefined }
}))

const { RemoteAccessService } = await import('../RemoteAccessService')

const desktop = nacl.box.keyPair()
const publicKey = Buffer.from(desktop.publicKey).toString('base64')

describe('remote Agent listener follows Device Connections', () => {
  let service: InstanceType<typeof RemoteAccessService>

  async function boot(serving = true) {
    gateway.serving = serving
    service = new RemoteAccessService()
    await service._doInit()
  }

  beforeEach(() => {
    BaseService.resetInstances()
    gateway.listeners.clear()
    // The service wipes the secret key when it stops listening, so every load hands out a fresh copy.
    loadIdentity.mockReset().mockImplementation(async () => ({
      instanceId: 'desktop-instance',
      secretKey: Uint8Array.from(desktop.secretKey),
      publicKey
    }))
  })

  afterEach(async () => {
    await service._doStop()
  })

  it('publishes a connection only while the gateway serves the LAN', async () => {
    await boot()
    expect(await service.getConnectionInfo()).toMatchObject({
      protocolVersion: 1,
      instanceId: 'desktop-instance',
      path: '/remote/v1/connect',
      serverPublicKey: publicKey
    })

    gateway.setServing(false)
    expect(await service.getConnectionInfo()).toBeUndefined()
  })

  it('never loads the identity while the gateway is not serving the LAN', async () => {
    await boot(false)
    expect(await service.getConnectionInfo()).toBeUndefined()
    expect(loadIdentity).not.toHaveBeenCalled()
  })

  it('starts listening as soon as the gateway begins serving the LAN, without a desktop request', async () => {
    await boot(false)
    gateway.setServing(true)
    await vi.waitFor(() => expect(service.peekConnectionInfo()).toMatchObject({ instanceId: 'desktop-instance' }))
  })

  it('closes for a backup and reopens under the same identity once the backup releases it', async () => {
    await boot()
    const hold = await service.suspendForBackup()
    expect(service.peekConnectionInfo()).toBeUndefined()
    expect(await service.getConnectionInfo()).toBeUndefined()

    hold.dispose()
    expect(await service.getConnectionInfo()).toMatchObject({
      instanceId: 'desktop-instance',
      serverPublicKey: publicKey
    })
  })

  it('never starts the listener for a discovery read, only for a trusted desktop request', async () => {
    loadIdentity.mockRejectedValueOnce(new Error('SECURE_STORAGE_UNAVAILABLE'))
    await boot()
    expect(loadIdentity).toHaveBeenCalledTimes(1)

    expect(service.peekConnectionInfo()).toBeUndefined()
    expect(service.peekConnectionInfo()).toBeUndefined()
    expect(loadIdentity).toHaveBeenCalledTimes(1)

    expect(await service.getConnectionInfo()).toMatchObject({ instanceId: 'desktop-instance' })
  })
})
