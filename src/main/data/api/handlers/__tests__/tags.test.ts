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

const TAG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TAG_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'

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

    it('should reject overlong names before calling create', async () => {
      await expect(
        tagHandlers['/tags'].POST({
          body: { name: 'x'.repeat(65), color: '#ff0000' }
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

      await expect(tagHandlers['/tags/:id'].GET({ params: { id: TAG_ID } } as never)).resolves.toEqual({
        id: 'tag-1',
        name: 'work'
      })

      await expect(
        tagHandlers['/tags/:id'].PATCH({
          params: { id: TAG_ID },
          body: { name: 'updated', color: null }
        } as never)
      ).resolves.toEqual({ id: 'tag-1', name: 'updated', color: null })

      await expect(tagHandlers['/tags/:id'].DELETE({ params: { id: TAG_ID } } as never)).resolves.toBeUndefined()

      expect(getTagByIdMock).toHaveBeenCalledWith(TAG_ID)
      expect(updateTagMock).toHaveBeenCalledWith(TAG_ID, { name: 'updated', color: null })
      expect(deleteTagMock).toHaveBeenCalledWith(TAG_ID)
    })

    it('should reject invalid tag ids in path params before calling the service', async () => {
      await expect(tagHandlers['/tags/:id'].GET({ params: { id: 'not-a-uuid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(getTagByIdMock).not.toHaveBeenCalled()
    })
  })

  describe('/tags/:id/entities', () => {
    it('should parse valid entity bindings', async () => {
      setEntitiesMock.mockResolvedValueOnce(undefined)

      await expect(
        tagHandlers['/tags/:id/entities'].PUT({
          params: { id: TAG_ID },
          body: {
            entities: [{ entityType: 'assistant', entityId: ENTITY_ID }]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(setEntitiesMock).toHaveBeenCalledWith(TAG_ID, {
        entities: [{ entityType: 'assistant', entityId: ENTITY_ID }]
      })
    })

    it('should reject duplicate entity bindings before calling the service', async () => {
      await expect(
        tagHandlers['/tags/:id/entities'].PUT({
          params: { id: TAG_ID },
          body: {
            entities: [
              { entityType: 'assistant', entityId: ENTITY_ID },
              { entityType: 'assistant', entityId: ENTITY_ID }
            ]
          }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(setEntitiesMock).not.toHaveBeenCalled()
    })

    it('should reject empty entity ids before calling the service', async () => {
      // Non-UUID strings are accepted at the schema layer because EntityIdSchema unions in
      // AgentIdSchema (`string().min(1)`); the structural floor is empty string.
      await expect(
        tagHandlers['/tags/:id/entities'].PUT({
          params: { id: TAG_ID },
          body: {
            entities: [{ entityType: 'assistant', entityId: '' }]
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
          params: { entityType: 'assistant', entityId: ENTITY_ID }
        } as never)
      ).resolves.toEqual([{ id: 'tag-1', name: 'work' }])

      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].PUT({
          params: { entityType: 'assistant', entityId: ENTITY_ID },
          body: { tagIds: [TAG_ID, OTHER_TAG_ID] }
        } as never)
      ).resolves.toBeUndefined()

      expect(getTagsByEntityMock).toHaveBeenCalledWith('assistant', ENTITY_ID)
      expect(syncEntityTagsMock).toHaveBeenCalledWith('assistant', ENTITY_ID, { tagIds: [TAG_ID, OTHER_TAG_ID] })
    })

    it('should reject invalid entityType before calling the service', async () => {
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].GET({
          params: { entityType: 'invalid', entityId: ENTITY_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(getTagsByEntityMock).not.toHaveBeenCalled()
    })

    it('should reject non-array tagIds before calling the service', async () => {
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].PUT({
          params: { entityType: 'assistant', entityId: ENTITY_ID },
          body: { tagIds: TAG_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(syncEntityTagsMock).not.toHaveBeenCalled()
    })

    it('should reject empty entity ids in params before calling the service', async () => {
      // EntityIdSchema only fails on empty string; non-UUID agent ids pass via AgentIdSchema.
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].GET({
          params: { entityType: 'assistant', entityId: '' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(getTagsByEntityMock).not.toHaveBeenCalled()
    })

    it('should reject invalid tag ids before calling the service', async () => {
      await expect(
        tagHandlers['/tags/entities/:entityType/:entityId'].PUT({
          params: { entityType: 'assistant', entityId: ENTITY_ID },
          body: { tagIds: ['not-a-uuid'] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(syncEntityTagsMock).not.toHaveBeenCalled()
    })
  })
})
