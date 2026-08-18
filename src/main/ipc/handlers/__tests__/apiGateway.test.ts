import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { apiGatewayHandlers } from '../apiGateway'

const apiGatewayService = { start: vi.fn(), stop: vi.fn(), restart: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService') return apiGatewayService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('apiGatewayHandlers', () => {
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

  it('stop returns the service outcome and restart delegates to the service', async () => {
    apiGatewayService.stop.mockResolvedValue('deferred')
    apiGatewayService.restart.mockResolvedValue(undefined)
    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({ success: true, outcome: 'deferred' })
    expect(await apiGatewayHandlers['api_gateway.restart'](undefined, ctx)).toEqual({ success: true })
    expect(apiGatewayService.stop).toHaveBeenCalledOnce()
    expect(apiGatewayService.restart).toHaveBeenCalledOnce()
  })

  it('stop turns a service throw into { success: false, error }', async () => {
    apiGatewayService.stop.mockRejectedValue(new Error('preference write failed'))

    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({
      success: false,
      error: 'preference write failed'
    })
  })
})
