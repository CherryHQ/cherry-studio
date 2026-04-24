import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAllMock,
  getByIdMock,
  createMock,
  updateMock,
  deleteMock,
  getVersionsMock,
  rollbackMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  getAllMock: vi.fn(),
  getByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getVersionsMock: vi.fn(),
  rollbackMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/PromptService', () => ({
  promptService: {
    getAll: getAllMock,
    getById: getByIdMock,
    create: createMock,
    update: updateMock,
    delete: deleteMock,
    getVersions: getVersionsMock,
    rollback: rollbackMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

import { promptHandlers } from '../prompts'

const PROMPT_ID = '019dbeea-3c00-73cb-acba-ec41b092cffa'
const OTHER_PROMPT_ID = '019dbeea-3c01-70e1-b362-63fb55a380f3'

describe('promptHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/prompts', () => {
    it('should delegate GET to promptService.getAll', async () => {
      getAllMock.mockResolvedValueOnce([{ id: PROMPT_ID, title: 't', content: 'c' }])
      await expect(promptHandlers['/prompts'].GET({} as never)).resolves.toMatchObject([{ id: PROMPT_ID }])
      expect(getAllMock).toHaveBeenCalledOnce()
    })

    it('should delegate POST with the parsed body', async () => {
      createMock.mockResolvedValueOnce({ id: PROMPT_ID, title: 't', content: 'c' })

      const result = await promptHandlers['/prompts'].POST({
        body: { title: 't', content: 'c' }
      } as never)

      expect(createMock).toHaveBeenCalledWith({ title: 't', content: 'c' })
      expect(result).toMatchObject({ id: PROMPT_ID })
    })

    it('should reject POST with empty title before calling the service', async () => {
      await expect(
        promptHandlers['/prompts'].POST({ body: { title: '', content: 'c' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject POST with empty content before calling the service', async () => {
      await expect(
        promptHandlers['/prompts'].POST({ body: { title: 't', content: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject POST with a missing required field', async () => {
      await expect(promptHandlers['/prompts'].POST({ body: { content: 'c' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject POST with an unknown field (strictObject)', async () => {
      await expect(
        promptHandlers['/prompts'].POST({
          body: { title: 't', content: 'c', sortOrder: 0 }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(createMock).not.toHaveBeenCalled()
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

    it('should reject GET with a non-UUIDv7 id', async () => {
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

    it('should reject PATCH with an empty-string title', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { title: '' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject PATCH with an unknown field (strictObject)', async () => {
      await expect(
        promptHandlers['/prompts/:id'].PATCH({
          params: { id: PROMPT_ID },
          body: { sortOrder: 0 }
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

  describe('/prompts/:id/versions', () => {
    it('should delegate GET with the parsed id', async () => {
      getVersionsMock.mockResolvedValueOnce([{ version: 1 }])
      await expect(
        promptHandlers['/prompts/:id/versions'].GET({ params: { id: PROMPT_ID } } as never)
      ).resolves.toEqual([{ version: 1 }])
      expect(getVersionsMock).toHaveBeenCalledWith(PROMPT_ID)
    })
  })

  describe('/prompts/:id/rollback', () => {
    it('should delegate POST with parsed id and version', async () => {
      rollbackMock.mockResolvedValueOnce({ id: PROMPT_ID, currentVersion: 4 })
      const result = await promptHandlers['/prompts/:id/rollback'].POST({
        params: { id: PROMPT_ID },
        body: { version: 2 }
      } as never)

      expect(rollbackMock).toHaveBeenCalledWith(PROMPT_ID, { version: 2 })
      expect(result).toMatchObject({ currentVersion: 4 })
    })

    it('should reject POST with version < 1', async () => {
      await expect(
        promptHandlers['/prompts/:id/rollback'].POST({
          params: { id: PROMPT_ID },
          body: { version: 0 }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(rollbackMock).not.toHaveBeenCalled()
    })

    it('should reject POST missing the version field', async () => {
      await expect(
        promptHandlers['/prompts/:id/rollback'].POST({
          params: { id: PROMPT_ID },
          body: {}
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(rollbackMock).not.toHaveBeenCalled()
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
