import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, createMock, getByIdMock, updateMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn()
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    list: listMock,
    create: createMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock
  }
}))

import { assistantHandlers } from '../assistants'

const ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'

describe('assistantHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/assistants', () => {
    it('should forward create bodies without injecting defaults', async () => {
      createMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'New Assistant' })

      await expect(
        assistantHandlers['/assistants'].POST({
          body: { name: 'New Assistant' }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(createMock).toHaveBeenCalledWith({
        name: 'New Assistant'
      })
    })

    it('should reject partial settings instead of filling nested defaults', async () => {
      await expect(
        assistantHandlers['/assistants'].POST({
          body: {
            name: 'New Assistant',
            settings: { maxTokens: 8192 }
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/:id', () => {
    it('should forward relation-only PATCH bodies without defaulted column fields', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { mcpServerIds: ['srv-1'], knowledgeBaseIds: ['kb-1'] }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })
    })

    it('should forward empty PATCH bodies without injecting create defaults', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: {}
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, {})
    })

    it('should reject partial settings updates before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { settings: { maxTokens: 8192 } }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })
  })
})
