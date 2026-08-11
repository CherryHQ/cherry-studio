import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listMock,
  listBindingsMock,
  listBoundToTargetMock,
  getByIdMock,
  createMock,
  updateMock,
  deleteMock,
  bindToTargetMock,
  unbindFromTargetMock,
  reorderMock,
  reorderBatchMock,
  reorderBindingMock,
  reorderBindingsMock
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  listBindingsMock: vi.fn(),
  listBoundToTargetMock: vi.fn(),
  getByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  bindToTargetMock: vi.fn(),
  unbindFromTargetMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderBindingMock: vi.fn(),
  reorderBindingsMock: vi.fn()
}))

vi.mock('@data/services/PromptService', () => ({
  promptService: {
    list: listMock,
    listBindings: listBindingsMock,
    listBoundToTarget: listBoundToTargetMock,
    getById: getByIdMock,
    create: createMock,
    update: updateMock,
    delete: deleteMock,
    bindToTarget: bindToTargetMock,
    unbindFromTarget: unbindFromTargetMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    reorderBinding: reorderBindingMock,
    reorderBindings: reorderBindingsMock
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
    it('should delegate GET to promptService.list', async () => {
      listMock.mockResolvedValueOnce([{ id: PROMPT_ID, title: 't', content: 'c' }])
      await expect(promptHandlers['/prompts'].GET({} as never)).resolves.toMatchObject([{ id: PROMPT_ID }])
      expect(listMock).toHaveBeenCalledWith({})
    })

    it('should parse and forward search query to promptService.list', async () => {
      listMock.mockResolvedValueOnce([])

      await expect(promptHandlers['/prompts'].GET({ query: { search: ' daily ' } } as never)).resolves.toEqual([])

      expect(listMock).toHaveBeenCalledWith({ search: 'daily' })
    })

    it('should parse and forward an Assistant binding filter', async () => {
      listMock.mockResolvedValueOnce([])

      await expect(
        promptHandlers['/prompts'].GET({
          query: { targetType: 'assistant', targetId: TARGET_ID, includeGlobal: true, search: ' daily ' }
        } as never)
      ).resolves.toEqual([])

      expect(listMock).toHaveBeenCalledWith({
        targetType: 'assistant',
        targetId: TARGET_ID,
        includeGlobal: true,
        search: 'daily'
      })
    })

    it('should reject empty search query before calling the service', async () => {
      await expect(promptHandlers['/prompts'].GET({ query: { search: '   ' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(listMock).not.toHaveBeenCalled()
    })

    it('should delegate POST with the selected visibility', async () => {
      createMock.mockResolvedValueOnce({ id: PROMPT_ID, title: 't', content: 'c' })

      const result = await promptHandlers['/prompts'].POST({
        body: { title: 't', content: 'c', visibility: 'global' }
      } as never)

      expect(createMock).toHaveBeenCalledWith({ title: 't', content: 'c', visibility: 'global' })
      expect(result).toMatchObject({ id: PROMPT_ID })
    })

    it('should delegate POST with an initial binding target', async () => {
      createMock.mockResolvedValueOnce({ id: PROMPT_ID, title: 't', content: 'c' })

      await promptHandlers['/prompts'].POST({
        body: {
          title: 't',
          content: 'c',
          visibility: 'restricted',
          bindingTarget: { type: 'agent', id: TARGET_ID }
        }
      } as never)

      expect(createMock).toHaveBeenCalledWith({
        title: 't',
        content: 'c',
        visibility: 'restricted',
        bindingTarget: { type: 'agent', id: TARGET_ID }
      })
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
    it('should idempotently delegate binding and unbinding', async () => {
      const params = { id: PROMPT_ID, targetType: 'assistant' as const, targetId: TARGET_ID }

      await expect(
        promptHandlers['/prompts/:id/bindings/:targetType/:targetId'].PUT({ params } as never)
      ).resolves.toBeUndefined()
      await expect(
        promptHandlers['/prompts/:id/bindings/:targetType/:targetId'].DELETE({ params } as never)
      ).resolves.toBeUndefined()

      expect(bindToTargetMock).toHaveBeenCalledWith(PROMPT_ID, { type: 'assistant', id: TARGET_ID })
      expect(unbindFromTargetMock).toHaveBeenCalledWith(PROMPT_ID, { type: 'assistant', id: TARGET_ID })
    })

    it('should reject invalid binding params before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id/bindings/:targetType/:targetId'].PUT({
          params: { id: PROMPT_ID, targetType: 'painting', targetId: TARGET_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(bindToTargetMock).not.toHaveBeenCalled()
    })
  })

  describe('/prompts/:id/bindings', () => {
    it('should list every binding for the prompt', async () => {
      listBindingsMock.mockReturnValueOnce([{ type: 'assistant', id: TARGET_ID }])

      await expect(
        promptHandlers['/prompts/:id/bindings'].GET({ params: { id: PROMPT_ID } } as never)
      ).resolves.toEqual([{ type: 'assistant', id: TARGET_ID }])
      expect(listBindingsMock).toHaveBeenCalledWith(PROMPT_ID)
    })
  })

  describe('/prompt-bindings/:targetType/:targetId', () => {
    it('should list prompts in target-specific order', async () => {
      listBoundToTargetMock.mockReturnValueOnce([{ id: PROMPT_ID }])

      await expect(
        promptHandlers['/prompt-bindings/:targetType/:targetId'].GET({
          params: { targetType: 'assistant', targetId: TARGET_ID }
        } as never)
      ).resolves.toEqual([{ id: PROMPT_ID }])
      expect(listBoundToTargetMock).toHaveBeenCalledWith({ type: 'assistant', id: TARGET_ID })
    })

    it('should delegate single and batch reorders within the target', async () => {
      const target = { targetType: 'assistant' as const, targetId: TARGET_ID }

      await promptHandlers['/prompt-bindings/:targetType/:targetId/:id/order'].PATCH({
        params: { ...target, id: PROMPT_ID },
        body: { before: OTHER_PROMPT_ID }
      } as never)
      await promptHandlers['/prompt-bindings/:targetType/:targetId/order:batch'].PATCH({
        params: target,
        body: { moves: [{ id: PROMPT_ID, anchor: { position: 'first' } }] }
      } as never)

      expect(reorderBindingMock).toHaveBeenCalledWith({ type: 'assistant', id: TARGET_ID }, PROMPT_ID, {
        before: OTHER_PROMPT_ID
      })
      expect(reorderBindingsMock).toHaveBeenCalledWith({ type: 'assistant', id: TARGET_ID }, [
        { id: PROMPT_ID, anchor: { position: 'first' } }
      ])
    })
  })

  describe('/prompts/:id', () => {
    it('should delegate GET with the parsed id', async () => {
      getByIdMock.mockResolvedValueOnce({ id: PROMPT_ID })
      await expect(promptHandlers['/prompts/:id'].GET({ params: { id: PROMPT_ID } } as never)).resolves.toMatchObject({
        id: PROMPT_ID
      })
      expect(getByIdMock).toHaveBeenCalledWith(PROMPT_ID)
    })

    it('should reject GET with a non-UUID id', async () => {
      await expect(
        promptHandlers['/prompts/:id'].GET({ params: { id: 'not-a-uuid' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(getByIdMock).not.toHaveBeenCalled()
    })

    it('should delegate PATCH with parsed id and body', async () => {
      updateMock.mockResolvedValueOnce({ id: PROMPT_ID, title: 'next', content: 'c' })

      const result = await promptHandlers['/prompts/:id'].PATCH({
        params: { id: PROMPT_ID },
        body: { title: 'next' }
      } as never)

      expect(updateMock).toHaveBeenCalledWith(PROMPT_ID, { title: 'next' })
      expect(result).toMatchObject({ title: 'next' })
    })

    it('should reject PATCH with an empty body before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: {}
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject PATCH with empty or removed fields', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { title: '' }
        } as never)
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

    it('should delegate DELETE with the parsed id', async () => {
      deleteMock.mockResolvedValueOnce(undefined)
      await expect(
        promptHandlers['/prompts/:id'].DELETE({ params: { id: PROMPT_ID } } as never)
      ).resolves.toBeUndefined()
      expect(deleteMock).toHaveBeenCalledWith(PROMPT_ID)
    })
  })

  describe('/prompts/:id/order', () => {
    it('should delegate PATCH with parsed id and anchor', async () => {
      reorderMock.mockResolvedValueOnce(undefined)
      await expect(
        promptHandlers['/prompts/:id/order'].PATCH({
          params: { id: PROMPT_ID },
          body: { before: OTHER_PROMPT_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderMock).toHaveBeenCalledWith(PROMPT_ID, { before: OTHER_PROMPT_ID })
    })

    it('should reject a malformed anchor before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/:id/order'].PATCH({
          params: { id: PROMPT_ID },
          body: { before: OTHER_PROMPT_ID, after: OTHER_PROMPT_ID }
        } as never)
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
    it('should delegate PATCH with the parsed moves array', async () => {
      reorderBatchMock.mockResolvedValueOnce(undefined)
      await expect(
        promptHandlers['/prompts/order:batch'].PATCH({
          body: {
            moves: [
              { id: PROMPT_ID, anchor: { position: 'first' } },
              { id: OTHER_PROMPT_ID, anchor: { after: PROMPT_ID } }
            ]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderBatchMock).toHaveBeenCalledWith([
        { id: PROMPT_ID, anchor: { position: 'first' } },
        { id: OTHER_PROMPT_ID, anchor: { after: PROMPT_ID } }
      ])
    })

    it('should reject an empty moves array before calling the service', async () => {
      await expect(
        promptHandlers['/prompts/order:batch'].PATCH({ body: { moves: [] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
