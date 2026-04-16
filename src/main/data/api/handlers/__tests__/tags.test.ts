import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listTagsMock,
  createTagMock,
  getTagByIdMock,
  updateTagMock,
  deleteTagMock,
  setEntitiesMock,
  getTagsByEntityMock,
  syncEntityTagsMock
} = vi.hoisted(() => ({
  listTagsMock: vi.fn(),
  createTagMock: vi.fn(),
  getTagByIdMock: vi.fn(),
  updateTagMock: vi.fn(),
  deleteTagMock: vi.fn(),
  setEntitiesMock: vi.fn(),
  getTagsByEntityMock: vi.fn(),
  syncEntityTagsMock: vi.fn()
}))

vi.mock('@data/services/TagService', () => ({
  tagService: {
    list: listTagsMock,
    create: createTagMock,
    getById: getTagByIdMock,
    update: updateTagMock,
    delete: deleteTagMock,
    setEntities: setEntitiesMock,
    getTagsByEntity: getTagsByEntityMock,
    syncEntityTags: syncEntityTagsMock
  }
}))

import { tagHandlers } from '../tags'

describe('tagHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/tags', () => {
    it('should delegate GET to tagService.list', async () => {
      listTagsMock.mockResolvedValueOnce([{ id: 'tag-1', name: 'work' }])

      const result = await tagHandlers['/tags'].GET({} as never)

      expect(listTagsMock).toHaveBeenCalledOnce()
      expect(result).toEqual([{ id: 'tag-1', name: 'work' }])
    })

    it('should parse POST bodies before calling create', async () => {
      createTagMock.mockResolvedValueOnce({ id: 'tag-1', name: 'work', color: '#ff0000' })

      await expect(
        tagHandlers['/tags'].POST({
          body: { name: 'work', color: '#ff0000' }
        } as never)
      ).resolves.toMatchObject({ id: 'tag-1' })

      expect(createTagMock).toHaveBeenCalledWith({ name: 'work', color: '#ff0000' })
    })

    it('should reject invalid colors before calling create', async () => {
      await expect(
        tagHandlers['/tags'].POST({
          body: { name: 'work', color: '#GGGGGG' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createTagMock).not.toHaveBeenCalled()
    })

    it('should reject empty names before calling create', async () => {
      await expect(
        tagHandlers['/tags'].POST({
          body: { name: '', color: '#ff0000' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createTagMock).not.toHaveBeenCalled()
    })
  })

  describe('/tags/:id', () => {
    it('should delegate GET/PATCH/DELETE with the path id', async () => {
      getTagByIdMock.mockResolvedValueOnce({ id: 'tag-1', name: 'work' })
      updateTagMock.mockResolvedValueOnce({ id: 'tag-1', name: 'updated', color: null })
      deleteTagMock.mockResolvedValueOnce(undefined)

      await expect(tagHandlers['/tags/:id'].GET({ params: { id: 'tag-1' } } as never)).resolves.toEqual({
        id: 'tag-1',
        name: 'work'
      })

      await expect(
        tagHandlers['/tags/:id'].PATCH({
          params: { id: 'tag-1' },
          body: { name: 'updated', color: null }
        } as never)
      ).resolves.toEqual({ id: 'tag-1', name: 'updated', color: null })

      await expect(tagHandlers['/tags/:id'].DELETE({ params: { id: 'tag-1' } } as never)).resolves.toBeUndefined()

      expect(getTagByIdMock).toHaveBeenCalledWith('tag-1')
      expect(updateTagMock).toHaveBeenCalledWith('tag-1', { name: 'updated', color: null })
      expect(deleteTagMock).toHaveBeenCalledWith('tag-1')
    })
  })

  describe('/tags/:id/entities', () => {
    it('should parse valid entity bindings', async () => {
      setEntitiesMock.mockResolvedValueOnce(undefined)

      await expect(
        tagHandlers['/tags/:id/entities'].PUT({
          params: { id: 'tag-1' },
          body: {
            entities: [{ entityType: 'assistant', entityId: 'ast-1' }]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(setEntitiesMock).toHaveBeenCalledWith('tag-1', {
        entities: [{ entityType: 'assistant', entityId: 'ast-1' }]
      })
    })

    it('should reject duplicate entity bindings before calling the service', async () => {
      await expect(
        tagHandlers['/tags/:id/entities'].PUT({
          params: { id: 'tag-1' },
          body: {
            entities: [
              { entityType: 'assistant', entityId: 'ast-1' },
              { entityType: 'assistant', entityId: 'ast-1' }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(setEntitiesMock).not.toHaveBeenCalled()
    })
  })

  describe('/tags/entities/:entityType/:entityId', () => {
    it('should parse valid params and body for GET/PUT', async () => {
      getTagsByEntityMock.mockResolvedValueOnce([{ id: 'tag-1', name: 'work' }])
      syncEntityTagsMock.mockResolvedValueOnce(undefined)

      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].GET({
          params: { entityType: 'assistant', entityId: 'ast-1' }
        } as never)
      ).resolves.toEqual([{ id: 'tag-1', name: 'work' }])

      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].PUT({
          params: { entityType: 'assistant', entityId: 'ast-1' },
          body: { tagIds: ['tag-1', 'tag-2'] }
        } as never)
      ).resolves.toBeUndefined()

      expect(getTagsByEntityMock).toHaveBeenCalledWith('assistant', 'ast-1')
      expect(syncEntityTagsMock).toHaveBeenCalledWith('assistant', 'ast-1', { tagIds: ['tag-1', 'tag-2'] })
    })

    it('should reject invalid entityType before calling the service', async () => {
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].GET({
          params: { entityType: 'invalid', entityId: 'ast-1' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(getTagsByEntityMock).not.toHaveBeenCalled()
    })

    it('should reject non-array tagIds before calling the service', async () => {
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].PUT({
          params: { entityType: 'assistant', entityId: 'ast-1' },
          body: { tagIds: 'tag-1' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(syncEntityTagsMock).not.toHaveBeenCalled()
    })
  })
})
