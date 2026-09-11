import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, getByIdMock, createMock, updateMock, bindToTargetMock, reorderMock, reorderBatchMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    getByIdMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
    bindToTargetMock: vi.fn(),
    reorderMock: vi.fn(),
    reorderBatchMock: vi.fn()
  })
)

vi.mock('@data/services/PromptService', () => ({
  promptService: {
    list: listMock,
    getById: getByIdMock,
    create: createMock,
    update: updateMock,
    bindToTarget: bindToTargetMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

import { promptHandlers } from '../prompts'

const PROMPT_ID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_PROMPT_ID = '550e8400-e29b-41d4-a716-446655440001'
const TARGET_ID = '550e8400-e29b-41d4-a716-446655440002'

describe('promptHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not expose removed version or rollback endpoints', () => {
    const handlers = promptHandlers as Record<string, unknown>
    expect(handlers['/prompts/:id/versions']).toBeUndefined()
    expect(handlers['/prompts/:id/rollback']).toBeUndefined()
  })

  describe('/prompts', () => {
    it('should reject empty search query before calling the service', async () => {
      await expect(promptHandlers['/prompts'].GET({ query: { search: '   ' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(listMock).not.toHaveBeenCalled()
    })

    it('should reject POST with empty fields before calling the service', async () => {
      await expect(
        promptHandlers['/prompts'].POST({ body: { title: '', content: 'c', visibility: 'global' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      await expect(
        promptHandlers['/prompts'].POST({ body: { title: 't', content: '', visibility: 'global' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject POST with a missing required field', async () => {
      await expect(
        promptHandlers['/prompts'].POST({ body: { content: 'c', visibility: 'global' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject POST with removed fields', async () => {
      await expect(
        promptHandlers['/prompts'].POST({
          body: { title: 't', content: 'c', visibility: 'global', variables: [] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      await expect(
        promptHandlers['/prompts'].POST({
          body: { title: 't', content: 'c', visibility: 'global', assistantId: OTHER_PROMPT_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/prompts/:id/bindings/:targetType/:targetId', () => {
    it('should reject invalid binding params before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id/bindings/:targetType/:targetId'].PUT({
          params: { id: PROMPT_ID, targetType: 'painting', targetId: TARGET_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(bindToTargetMock).not.toHaveBeenCalled()
    })
  })

  describe('/prompts/:id', () => {
    it('should reject GET with a non-UUID id', async () => {
      await expect(promptHandlers['/prompts/:id'].GET({ params: { id: 'not-a-uuid' } })).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(getByIdMock).not.toHaveBeenCalled()
    })

    it('should reject PATCH with an empty body before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: {}
        })
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject PATCH with empty or removed fields', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { title: '' }
        })
      ).rejects.toHaveProperty('name', 'ZodError')
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { currentVersion: 2 }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { variables: [] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('/prompts/:id/order', () => {
    it('should reject a malformed anchor before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id/order'].PATCH({
          params: { id: PROMPT_ID },
          body: { before: OTHER_PROMPT_ID, after: OTHER_PROMPT_ID }
        })
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should reject PATCH when the id is not a UUID', async () => {
      await expect(
        promptHandlers['/prompts/:id/order'].PATCH({
          params: { id: 'not-a-uuid' },
          body: { position: 'first' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/prompts/order:batch', () => {
    it('should reject an empty moves array before calling the service', async () => {
      await expect(promptHandlers['/prompts/order:batch'].PATCH({ body: { moves: [] } })).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
