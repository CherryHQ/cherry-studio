import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  updateMock,
  deleteMock,
  listSessionMessagesMock,
  deleteSessionMessageMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listByCursorMock: vi.fn(),
  createSessionMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/SessionService', () => ({
  sessionService: {
    listByCursor: listByCursorMock,
    createSession: createSessionMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

import { sessionHandlers } from '../sessions'

describe('sessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/sessions', () => {
    it('forwards trimmed search to sessionService.listByCursor', async () => {
      const response = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(response)

      const result = await sessionHandlers['/sessions'].GET({
        query: {
          search: '  deploy  ',
          limit: '10'
        }
      } as never)

      expect(listByCursorMock).toHaveBeenCalledWith({
        search: 'deploy',
        limit: 10
      })
      expect(result).toBe(response)
    })

    it('rejects blank search before calling the service', async () => {
      await expect(
        sessionHandlers['/sessions'].GET({
          query: {
            search: '   '
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(listByCursorMock).not.toHaveBeenCalled()
    })
  })
})
