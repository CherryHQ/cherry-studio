import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { openclawHandlers } from '../openclaw'

const openClawService = {
  getStatus: vi.fn(),
  startGateway: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'OpenClawService') return openClawService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('openclawHandlers', () => {
  describe('openclaw.start_gateway', () => {
    it('unwraps { port } and forwards it to the service', async () => {
      openClawService.startGateway.mockResolvedValue({ success: true })
      const result = await openclawHandlers['openclaw.start_gateway']({ port: 18888 }, ctx)
      expect(openClawService.startGateway).toHaveBeenCalledWith(18888)
      expect(result).toEqual({ success: true })
    })

    it('turns a thrown service error into a failed OperationResult instead of rejecting', async () => {
      openClawService.startGateway.mockRejectedValue(new Error('bind failed'))
      await expect(openclawHandlers['openclaw.start_gateway']({}, ctx)).resolves.toEqual({
        success: false,
        message: 'bind failed'
      })
    })
  })

  describe('openclaw.get_status', () => {
    it('projects to { status }, keeping the gateway port off the wire', async () => {
      // The renderer owns the port via preference and only consumes status here; the handler must
      // drop getStatus()'s port (the router does not re-parse output, so extra fields would leak).
      openClawService.getStatus.mockResolvedValue({ status: 'running', port: 4567 })
      const result = await openclawHandlers['openclaw.get_status'](undefined, ctx)
      expect(result).toEqual({ status: 'running' })
    })
  })
})
