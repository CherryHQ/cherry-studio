import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import nacl from 'tweetnacl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const { loadIdentity } = vi.hoisted(() => ({ loadIdentity: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('../identity', () => ({ loadIdentity }))
vi.mock('../agentAccess', () => ({ assertWritable: vi.fn() }))
vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: { onDeleted: () => ({ dispose: () => {} }), findByTokenHash: () => undefined }
}))

const { RemoteAccessService } = await import('../RemoteAccessService')
const { application } = await import('@application')

const desktop = nacl.box.keyPair()
const publicKey = Buffer.from(desktop.publicKey).toString('base64')

describe('remote Agent listener follows Device Connections', () => {
  let service: InstanceType<typeof RemoteAccessService>

  async function boot(settings: { enabled?: boolean; host?: string; lanRunning?: boolean } = {}) {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', settings.enabled ?? true)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', settings.host ?? '0.0.0.0')
    application.get('CacheService').setShared('feature.api_gateway.lan_running', settings.lanRunning ?? true)
    service = new RemoteAccessService()
    await service._doInit()
  }

  beforeEach(() => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainCacheServiceUtils.resetMocks()
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

  it('publishes a connection only while device connections are enabled, on the LAN, and running', async () => {
    await boot()
    expect(await service.getConnectionInfo()).toMatchObject({
      protocolVersion: 1,
      instanceId: 'desktop-instance',
      path: '/remote/v1/connect',
      serverPublicKey: publicKey
    })

    MockMainPreferenceServiceUtils.simulateExternalPreferenceChange('feature.api_gateway.enabled', false)
    expect(await service.getConnectionInfo()).toBeUndefined()
  })

  it.each([
    ['device connections are off', { enabled: false }],
    ['the gateway is loopback-only', { host: '127.0.0.1' }],
    ['the LAN listener is not running', { lanRunning: false }]
  ])('does not listen when %s', async (_reason, settings) => {
    await boot(settings)
    expect(await service.getConnectionInfo()).toBeUndefined()
    expect(loadIdentity).not.toHaveBeenCalled()
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
