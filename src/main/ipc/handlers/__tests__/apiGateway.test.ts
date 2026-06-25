import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { apiGatewayHandlers } from '../apiGateway'

const apiGatewayService = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService') return apiGatewayService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('apiGatewayHandlers', () => {
  it('start delegates to ApiGatewayService.start and returns success on ok', async () => {
    apiGatewayService.start.mockResolvedValue(undefined)

    const result = await apiGatewayHandlers['api_gateway.start'](undefined, ctx)

    expect(apiGatewayService.start).toHaveBeenCalledWith()
    expect(result).toEqual({ success: true })
  })

  it('start catches service errors and returns failure status', async () => {
    apiGatewayService.start.mockRejectedValue(new Error('port in use'))

    const result = await apiGatewayHandlers['api_gateway.start'](undefined, ctx)

    expect(apiGatewayService.start).toHaveBeenCalledWith()
    expect(result).toEqual({ success: false, error: 'port in use' })
  })

  it('start handles non-Error throwables', async () => {
    apiGatewayService.start.mockRejectedValue('string error')

    const result = await apiGatewayHandlers['api_gateway.start'](undefined, ctx)

    expect(result).toEqual({ success: false, error: 'Unknown error' })
  })

  it('stop delegates to ApiGatewayService.stop and returns success on ok', async () => {
    apiGatewayService.stop.mockResolvedValue(undefined)

    const result = await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)

    expect(apiGatewayService.stop).toHaveBeenCalledWith()
    expect(result).toEqual({ success: true })
  })

  it('stop catches service errors and returns failure status', async () => {
    apiGatewayService.stop.mockRejectedValue(new Error('not running'))

    const result = await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)

    expect(result).toEqual({ success: false, error: 'not running' })
  })

  it('restart delegates to ApiGatewayService.restart and returns success on ok', async () => {
    apiGatewayService.restart.mockResolvedValue(undefined)

    const result = await apiGatewayHandlers['api_gateway.restart'](undefined, ctx)

    expect(apiGatewayService.restart).toHaveBeenCalledWith()
    expect(result).toEqual({ success: true })
  })

  it('restart catches service errors and returns failure status', async () => {
    apiGatewayService.restart.mockRejectedValue(new Error('stop failed'))

    const result = await apiGatewayHandlers['api_gateway.restart'](undefined, ctx)

    expect(result).toEqual({ success: false, error: 'stop failed' })
  })
})
