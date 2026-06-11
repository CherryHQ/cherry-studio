import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, createMock, getByIdMock, updateMock, deleteMock, reorderMock, reorderBatchMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    list: listMock,
    create: createMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

import { assistantHandlers } from '../assistants'

const ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ASSISTANT_ID = '33333333-3333-4333-8333-333333333333'
const TAG_ID = '22222222-2222-4222-8222-222222222222'

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

    it('should reject direct orderKey writes on create', async () => {
      await expect(
        assistantHandlers['/assistants'].POST({
          body: { name: 'New Assistant', orderKey: 'a0' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/:id', () => {
    it('should forward tag-only PATCH bodies without defaulted column fields', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { tagIds: [TAG_ID] }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, { tagIds: [TAG_ID] })
    })

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

    it('should forward partial settings updates without injecting unrelated defaults', async () => {
      updateMock.mockResolvedValueOnce({ id: ASSISTANT_ID, name: 'Existing Assistant' })

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { settings: { maxTokens: 8192 } }
        } as never)
      ).resolves.toMatchObject({ id: ASSISTANT_ID })

      expect(updateMock).toHaveBeenCalledWith(ASSISTANT_ID, { settings: { maxTokens: 8192 } })
    })

    it('should reject invalid tag ids before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { tagIds: ['not-a-uuid'] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject direct orderKey writes on update', async () => {
      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { orderKey: 'a0' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/:id/order', () => {
    it('should forward a parsed single reorder anchor', async () => {
      reorderMock.mockResolvedValueOnce(undefined)

      await expect(
        assistantHandlers['/assistants/:id/order'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { before: OTHER_ASSISTANT_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderMock).toHaveBeenCalledWith(ASSISTANT_ID, { before: OTHER_ASSISTANT_ID })
    })

    it('should reject malformed anchors before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/:id/order'].PATCH({
          params: { id: ASSISTANT_ID },
          body: { before: OTHER_ASSISTANT_ID, after: OTHER_ASSISTANT_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/order:batch', () => {
    it('should forward parsed batch reorder moves', async () => {
      reorderBatchMock.mockResolvedValueOnce(undefined)

      await expect(
        assistantHandlers['/assistants/order:batch'].PATCH({
          body: {
            moves: [
              { id: ASSISTANT_ID, anchor: { position: 'first' } },
              { id: OTHER_ASSISTANT_ID, anchor: { after: ASSISTANT_ID } }
            ]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderBatchMock).toHaveBeenCalledWith([
        { id: ASSISTANT_ID, anchor: { position: 'first' } },
        { id: OTHER_ASSISTANT_ID, anchor: { after: ASSISTANT_ID } }
      ])
    })

    it('should reject an empty move list before calling the service', async () => {
      await expect(
        assistantHandlers['/assistants/order:batch'].PATCH({ body: { moves: [] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
