import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { openclawHandlers } from '../openclaw'

const openClawService = {
  getStatus: vi.fn()
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
