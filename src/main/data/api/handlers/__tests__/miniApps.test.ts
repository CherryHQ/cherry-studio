import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, createMock, getByAppIdMock, updateMock, deleteMock, reorderMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getByAppIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  reorderMock: vi.fn()
}))

vi.mock('@data/services/MiniAppService', () => ({
  miniAppService: {
    list: listMock,
    create: createMock,
    getByAppId: getByAppIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock
  }
}))

import { miniAppHandlers } from '../miniApps'

describe('miniAppHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /mini-apps', () => {
    it('should delegate empty query to service', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/mini-apps'].GET({ query: undefined })

      expect(listMock).toHaveBeenCalledWith({})
      expect(result).toEqual(response)
    })

    it('should delegate filters to service', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/mini-apps'].GET({ query: { status: 'enabled', type: 'default' } } as never)

      expect(listMock).toHaveBeenCalledWith({ status: 'enabled', type: 'default' })
      expect(result).toEqual(response)
    })

    it('should handle missing query gracefully', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/mini-apps'].GET({})

      expect(listMock).toHaveBeenCalledWith({})
      expect(result).toEqual(response)
    })

    it('should reject invalid status enum before calling the service', async () => {
      await expect(miniAppHandlers['/mini-apps'].GET({ query: { status: 'invalid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(listMock).not.toHaveBeenCalled()
    })

    it('should reject invalid type enum before calling the service', async () => {
      await expect(miniAppHandlers['/mini-apps'].GET({ query: { type: 'premium' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(listMock).not.toHaveBeenCalled()
    })
  })

  describe('POST /mini-apps', () => {
    const validBody = {
      appId: 'my-app',
      name: 'My App',
      url: 'https://my.app',
      logo: 'application',
      bordered: true,
      supportedRegions: ['CN', 'Global'] as ('CN' | 'Global')[]
    }

    it('should parse body and delegate to service', async () => {
      const created = {
        appId: 'my-app',
        kind: 'custom',
        status: 'enabled',
        orderKey: 'a0',
        name: 'My App',
        url: 'https://my.app'
      }
      createMock.mockResolvedValueOnce(created)

      const result = await miniAppHandlers['/mini-apps'].POST({ body: validBody })

      expect(createMock).toHaveBeenCalledWith(validBody)
      expect(result).toEqual(created)
    })

    it('should reject missing required fields before calling the service', async () => {
      await expect(miniAppHandlers['/mini-apps'].POST({ body: { appId: '' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty name before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps'].POST({ body: { ...validBody, name: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty url before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps'].POST({ body: { ...validBody, url: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty logo before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps'].POST({ body: { ...validBody, logo: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with invalid region before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps'].POST({ body: { ...validBody, supportedRegions: ['EU'] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty supportedRegions before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps'].POST({ body: { ...validBody, supportedRegions: [] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /mini-apps/:id/order', () => {
    it('should parse body and delegate single-move reorder to service', async () => {
      reorderMock.mockResolvedValueOnce(undefined)

      await miniAppHandlers['/mini-apps/:id/order'].PATCH({
        params: { id: 'openai' },
        body: { after: 'gemini' }
      } as never)

      expect(reorderMock).toHaveBeenCalledWith([{ id: 'openai', anchor: { after: 'gemini' } }])
    })

    it('should reject body that does not match the anchor union', async () => {
      await expect(
        miniAppHandlers['/mini-apps/:id/order'].PATCH({
          params: { id: 'openai' },
          body: { sortOrder: 0 } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /mini-apps/order:batch', () => {
    it('should parse body and delegate batch reorder to service', async () => {
      reorderMock.mockResolvedValueOnce(undefined)
      const moves = [
        { id: 'openai', anchor: { after: 'gemini' } },
        { id: 'qwen', anchor: { position: 'first' as const } }
      ]

      await miniAppHandlers['/mini-apps/order:batch'].PATCH({ body: { moves } } as never)

      expect(reorderMock).toHaveBeenCalledWith(moves)
    })

    it('should reject empty id in moves before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps/order:batch'].PATCH({
          body: { moves: [{ id: '', anchor: { position: 'first' } }] } as never
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /mini-apps/:appId', () => {
    it('should delegate to service with path appId', async () => {
      const app = {
        appId: 'openai',
        type: 'default',
        status: 'enabled',
        sortOrder: 0,
        name: 'ChatGPT',
        url: 'https://chatgpt.com/'
      }
      getByAppIdMock.mockResolvedValueOnce(app)

      const result = await miniAppHandlers['/mini-apps/:appId'].GET({ params: { appId: 'openai' } })

      expect(getByAppIdMock).toHaveBeenCalledWith('openai')
      expect(result).toEqual(app)
    })
  })

  describe('PATCH /mini-apps/:appId', () => {
    it('should parse body and delegate to service', async () => {
      const updated = {
        appId: 'custom-app',
        type: 'custom',
        status: 'disabled',
        sortOrder: 0,
        name: 'My App',
        url: 'https://my.app'
      }
      updateMock.mockResolvedValueOnce(updated)

      const result = await miniAppHandlers['/mini-apps/:appId'].PATCH({
        params: { appId: 'custom-app' },
        body: { status: 'disabled' }
      })

      expect(updateMock).toHaveBeenCalledWith('custom-app', { status: 'disabled' })
      expect(result).toMatchObject({ status: 'disabled' })
    })

    it('should reject invalid status in PATCH body before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps/:appId'].PATCH({ params: { appId: 'openai' }, body: { status: 'banned' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject invalid region in PATCH body before calling the service', async () => {
      await expect(
        miniAppHandlers['/mini-apps/:appId'].PATCH({
          params: { appId: 'openai' },
          body: { supportedRegions: ['EU'] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should pass empty body {} through to service (service rejects no-updatable-fields)', async () => {
      updateMock.mockRejectedValueOnce(
        Object.assign(new Error('No applicable fields'), { code: 'VALIDATION_ERROR', status: 422 })
      )

      await expect(
        miniAppHandlers['/mini-apps/:appId'].PATCH({ params: { appId: 'openai' }, body: {} })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      // Empty body is valid Zod — UpdateMiniAppSchema allows all optional fields
      expect(updateMock).toHaveBeenCalledWith('openai', {})
    })
  })

  describe('DELETE /mini-apps/:appId', () => {
    it('should delegate to service with path appId', async () => {
      deleteMock.mockResolvedValueOnce(undefined)

      await miniAppHandlers['/mini-apps/:appId'].DELETE({ params: { appId: 'custom-app' } })

      expect(deleteMock).toHaveBeenCalledWith('custom-app')
    })
  })
})
