import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcRouter } from '@main/ipc/IpcRouter'
import { apiGatewayRequestSchemas } from '@shared/ipc/schemas/apiGateway'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { apiGatewayHandlers } from '../apiGateway'

const apiGatewayService = { start: vi.fn(), stop: vi.fn(), restart: vi.fn(), createPairingOffer: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService') return apiGatewayService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('apiGatewayHandlers', () => {
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
