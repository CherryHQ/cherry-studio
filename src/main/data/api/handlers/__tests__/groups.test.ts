import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listByEntityTypeMock, createMock, getByIdMock, updateMock, deleteMock, reorderMock, reorderBatchMock } =
  vi.hoisted(() => ({
    listByEntityTypeMock: vi.fn(),
    createMock: vi.fn(),
    getByIdMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    reorderMock: vi.fn(),
    reorderBatchMock: vi.fn()
  }))

vi.mock('@data/services/GroupService', () => ({
  groupService: {
    listByEntityType: listByEntityTypeMock,
    create: createMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

import { groupHandlers } from '../groups'

const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_GROUP_ID = '22222222-2222-4222-8222-222222222222'

describe('groupHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/groups GET', () => {
    it('should delegate GET to groupService.listByEntityType', async () => {
      listByEntityTypeMock.mockResolvedValueOnce([{ id: 'g1', entityType: 'topic', name: 'A' }])

      const result = await groupHandlers['/groups'].GET({
        query: { entityType: 'topic' }
      } as never)

      expect(listByEntityTypeMock).toHaveBeenCalledWith('topic')
      expect(result).toEqual([{ id: 'g1', entityType: 'topic', name: 'A' }])
    })

    it('should reject a missing entityType query param with ZodError', async () => {
      await expect(groupHandlers['/groups'].GET({ query: {} } as never)).rejects.toHaveProperty('name', 'ZodError')

      expect(listByEntityTypeMock).not.toHaveBeenCalled()
    })

    it('should reject an unknown entityType query value with ZodError', async () => {
      await expect(groupHandlers['/groups'].GET({ query: { entityType: 'invalid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(listByEntityTypeMock).not.toHaveBeenCalled()
    })
  })

  describe('/groups POST', () => {
    it('should parse POST body and call create', async () => {
      createMock.mockResolvedValueOnce({ id: 'g1', entityType: 'topic', name: 'Research' })

      await expect(
        groupHandlers['/groups'].POST({
          body: { entityType: 'topic', name: 'Research' }
        } as never)
      ).resolves.toMatchObject({ id: 'g1' })

      expect(createMock).toHaveBeenCalledWith({ entityType: 'topic', name: 'Research' })
    })

    it('should reject unknown entityType in POST body with ZodError', async () => {
      await expect(
        groupHandlers['/groups'].POST({
          body: { entityType: 'bogus', name: 'Research' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject empty names in POST body with ZodError', async () => {
      await expect(
        groupHandlers['/groups'].POST({
          body: { entityType: 'topic', name: '' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/groups/:id', () => {
    it('should parse path id and body for GET / PATCH / DELETE', async () => {
      getByIdMock.mockResolvedValueOnce({ id: 'g1', entityType: 'topic', name: 'A' })
      updateMock.mockResolvedValueOnce({ id: 'g1', entityType: 'topic', name: 'Renamed' })
      deleteMock.mockResolvedValueOnce(undefined)

      await expect(groupHandlers['/groups/:id'].GET({ params: { id: GROUP_ID } } as never)).resolves.toMatchObject({
        id: 'g1'
      })

      await expect(
        groupHandlers['/groups/:id'].PATCH({
          params: { id: GROUP_ID },
          body: { name: 'Renamed' }
        } as never)
      ).resolves.toMatchObject({ name: 'Renamed' })

      await expect(groupHandlers['/groups/:id'].DELETE({ params: { id: GROUP_ID } } as never)).resolves.toBeUndefined()

      expect(getByIdMock).toHaveBeenCalledWith(GROUP_ID)
      expect(updateMock).toHaveBeenCalledWith(GROUP_ID, { name: 'Renamed' })
      expect(deleteMock).toHaveBeenCalledWith(GROUP_ID)
    })

    it('should reject an invalid group id in path params with ZodError', async () => {
      await expect(groupHandlers['/groups/:id'].GET({ params: { id: 'not-a-uuid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(getByIdMock).not.toHaveBeenCalled()
    })

    it('should reject an invalid PATCH body (name type wrong) with ZodError', async () => {
      await expect(
        groupHandlers['/groups/:id'].PATCH({
          params: { id: GROUP_ID },
          body: { name: 123 }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('/groups/:id/order', () => {
    it('should delegate a valid anchor body to groupService.reorder', async () => {
      reorderMock.mockResolvedValueOnce(undefined)

      await expect(
        groupHandlers['/groups/:id/order'].PATCH({
          params: { id: GROUP_ID },
          body: { position: 'first' }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderMock).toHaveBeenCalledWith(GROUP_ID, { position: 'first' })
    })

    it('should reject an invalid anchor body with ZodError', async () => {
      await expect(
        groupHandlers['/groups/:id/order'].PATCH({
          params: { id: GROUP_ID },
          body: { position: 'middle' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should reject when id is not a valid uuid', async () => {
      await expect(
        groupHandlers['/groups/:id/order'].PATCH({
          params: { id: 'not-a-uuid' },
          body: { position: 'first' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/groups/order:batch', () => {
    it('should delegate a valid batch body to groupService.reorderBatch', async () => {
      reorderBatchMock.mockResolvedValueOnce(undefined)

      const moves = [
        { id: GROUP_ID, anchor: { position: 'first' } },
        { id: OTHER_GROUP_ID, anchor: { after: GROUP_ID } }
      ]

      await expect(groupHandlers['/groups/order:batch'].PATCH({ body: { moves } } as never)).resolves.toBeUndefined()

      expect(reorderBatchMock).toHaveBeenCalledWith(moves)
    })

    it('should reject an empty moves array with ZodError', async () => {
      await expect(groupHandlers['/groups/order:batch'].PATCH({ body: { moves: [] } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(reorderBatchMock).not.toHaveBeenCalled()
    })

    it('should reject a malformed move entry with ZodError', async () => {
      await expect(
        groupHandlers['/groups/order:batch'].PATCH({
          body: { moves: [{ id: '', anchor: { position: 'first' } }] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
