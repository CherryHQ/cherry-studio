import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createDeviceMock } = vi.hoisted(() => ({ createDeviceMock: vi.fn() }))

vi.mock('@data/services/ApiGatewayPairedDeviceService', () => ({
  apiGatewayPairedDeviceService: { create: createDeviceMock }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

import { ApiGatewayPairing } from '../ApiGatewayPairing'

const DEVICE_INPUT = { name: 'Pixel', platform: 'android' }
const DEVICE = {
  id: '11111111-1111-4111-8111-111111111111',
  ...DEVICE_INPUT,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z'
}

describe('ApiGatewayPairing', () => {
  beforeEach(() => {
    createDeviceMock.mockReset()
    createDeviceMock.mockReturnValue(DEVICE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the raw token once while persisting only its hash', () => {
    const pairing = new ApiGatewayPairing()
    const result = pairing.consumeCode(pairing.createCode().code, DEVICE_INPUT)

    expect(result).toEqual({ device: DEVICE, token: expect.stringMatching(/^cs-dt-/) })
    expect(createDeviceMock).toHaveBeenCalledWith({
      ...DEVICE_INPUT,
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(createDeviceMock.mock.calls[0][0]).not.toHaveProperty('token')
  })

  it('reuses an unexpired offer instead of invalidating another window QR', () => {
    const pairing = new ApiGatewayPairing()
    expect(pairing.createCode()).toEqual(pairing.createCode())
  })

  it('allows one successful exchange only', () => {
    const pairing = new ApiGatewayPairing()
    const { code } = pairing.createCode()

    expect(pairing.consumeCode(code, DEVICE_INPUT)).not.toBeNull()
    expect(pairing.consumeCode(code, DEVICE_INPUT)).toBeNull()
    expect(createDeviceMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired code', () => {
    vi.useFakeTimers()
    const pairing = new ApiGatewayPairing()
    const { code, expiresAt } = pairing.createCode()

    vi.setSystemTime(expiresAt + 1)
    expect(pairing.consumeCode(code, DEVICE_INPUT)).toBeNull()
    expect(createDeviceMock).not.toHaveBeenCalled()
  })

  it('invalidates a code after the wrong-attempt budget is exhausted', () => {
    const pairing = new ApiGatewayPairing()
    const code = pairing.createCode().code
    for (let i = 0; i < 10; i++) pairing.consumeCode('wrong-guess', DEVICE_INPUT)

    expect(pairing.consumeCode(code, DEVICE_INPUT)).toBeNull()
    expect(createDeviceMock).not.toHaveBeenCalled()
  })
})
