import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcRouter } from '@main/ipc/IpcRouter'
import { apiGatewayRequestSchemas } from '@shared/ipc/schemas/apiGateway'

const { apiGatewayService } = vi.hoisted(() => ({
  apiGatewayService: {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    setLanEnabled: vi.fn(),
    createPairingOffer: vi.fn()
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ ApiGatewayService: apiGatewayService } as any)
})

import { apiGatewayHandlers } from '../apiGateway'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('apiGatewayHandlers', () => {
  it('propagates LAN startup failures through the IpcApi error channel', async () => {
    apiGatewayService.setLanEnabled.mockRejectedValueOnce(new Error('bind failed'))
    const router = new IpcRouter(apiGatewayRequestSchemas, apiGatewayHandlers)

    await expect(router.dispatch('api_gateway.lan.set_enabled', { enabled: true }, ctx)).rejects.toThrow('bind failed')
  })

  it('propagates pairing failures to the IpcApi error channel', async () => {
    apiGatewayService.createPairingOffer.mockImplementation(() => {
      throw new Error('API Gateway is not running')
    })
    const router = new IpcRouter(apiGatewayRequestSchemas, apiGatewayHandlers)

    await expect(router.dispatch('api_gateway.create_pairing_offer', undefined, ctx)).rejects.toThrow(
      'API Gateway is not running'
    )
  })

  it('start returns success when the service starts cleanly', async () => {
    apiGatewayService.start.mockResolvedValue(undefined)
    expect(await apiGatewayHandlers['api_gateway.start'](undefined, ctx)).toEqual({ success: true })
  })

  it('start turns a service throw into { success: false, error }', async () => {
    apiGatewayService.start.mockRejectedValue(new Error('port in use'))
    expect(await apiGatewayHandlers['api_gateway.start'](undefined, ctx)).toEqual({
      success: false,
      error: 'port in use'
    })
  })

  it('stop reports deferred shutdown and restart reports success', async () => {
    apiGatewayService.stop.mockResolvedValue('deferred')
    apiGatewayService.restart.mockResolvedValue(undefined)
    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({ success: true, outcome: 'deferred' })
    expect(await apiGatewayHandlers['api_gateway.restart'](undefined, ctx)).toEqual({ success: true })
  })

  it('stop turns a service throw into { success: false, error }', async () => {
    apiGatewayService.stop.mockRejectedValue(new Error('preference write failed'))

    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({
      success: false,
      error: 'preference write failed'
    })
  })
})
