import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, createMock, getByAppIdMock, updateMock, deleteMock, reorderMock, resetDefaultsMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
    getByAppIdMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    reorderMock: vi.fn(),
    resetDefaultsMock: vi.fn()
  })
)

vi.mock('@data/services/MiniAppService', () => ({
  miniAppService: {
    list: listMock,
    create: createMock,
    getByAppId: getByAppIdMock,
    update: updateMock,
    delete: deleteMock,
    reorder: reorderMock,
    resetDefaults: resetDefaultsMock
  }
}))

import { miniAppHandlers } from '../miniapps'

describe('miniAppHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /miniapps', () => {
    it('should delegate empty query to service', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/miniapps'].GET({ query: {} })

      expect(listMock).toHaveBeenCalledWith({})
      expect(result).toEqual(response)
    })

    it('should delegate filters to service', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/miniapps'].GET({ query: { status: 'enabled', type: 'default' } } as never)

      expect(listMock).toHaveBeenCalledWith({ status: 'enabled', type: 'default' })
      expect(result).toEqual(response)
    })

    it('should handle missing query gracefully', async () => {
      const response = { items: [], total: 0, page: 1 }
      listMock.mockResolvedValueOnce(response)

      const result = await miniAppHandlers['/miniapps'].GET({})

      expect(listMock).toHaveBeenCalledWith({})
      expect(result).toEqual(response)
    })

    it('should reject invalid status enum before calling the service', async () => {
      await expect(miniAppHandlers['/miniapps'].GET({ query: { status: 'invalid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(listMock).not.toHaveBeenCalled()
    })

    it('should reject invalid type enum before calling the service', async () => {
      await expect(miniAppHandlers['/miniapps'].GET({ query: { type: 'premium' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(listMock).not.toHaveBeenCalled()
    })
  })

  describe('POST /miniapps', () => {
    const validBody = {
      appId: 'my-app',
      name: 'My App',
      url: 'https://my.app',
      logo: 'application',
      bordered: true,
      supportedRegions: ['CN', 'Global'] as const
    }

    it('should parse body and delegate to service', async () => {
      const created = {
        appId: 'my-app',
        type: 'custom',
        status: 'enabled',
        sortOrder: 0,
        name: 'My App',
        url: 'https://my.app'
      }
      createMock.mockResolvedValueOnce(created)

      const result = await miniAppHandlers['/miniapps'].POST({ body: validBody })

      expect(createMock).toHaveBeenCalledWith(validBody)
      expect(result).toMatchObject({ appId: 'my-app' })
    })

    it('should reject missing required fields before calling the service', async () => {
      await expect(miniAppHandlers['/miniapps'].POST({ body: { appId: '' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty name before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].POST({ body: { ...validBody, name: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty url before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].POST({ body: { ...validBody, url: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty logo before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].POST({ body: { ...validBody, logo: '' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with invalid region before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].POST({ body: { ...validBody, supportedRegions: ['EU'] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })

    it('should reject body with empty supportedRegions before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].POST({ body: { ...validBody, supportedRegions: [] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /miniapps (reorder)', () => {
    const validReorderBody = {
      items: [{ appId: 'openai', sortOrder: 0 }]
    }

    it('should parse body and delegate reorder to service', async () => {
      reorderMock.mockResolvedValueOnce(undefined)

      await miniAppHandlers['/miniapps'].PATCH({ body: validReorderBody })

      expect(reorderMock).toHaveBeenCalledWith(validReorderBody.items)
    })

    it('should reject empty appId in reorder items before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].PATCH({ body: { items: [{ appId: '', sortOrder: 0 }] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should reject non-integer sortOrder before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].PATCH({ body: { items: [{ appId: 'openai', sortOrder: 1.5 }] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should reject non-number sortOrder before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps'].PATCH({ body: { items: [{ appId: 'openai', sortOrder: 'first' }] } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /miniapps/:id', () => {
    it('should delegate to service with path id', async () => {
      const app = {
        appId: 'openai',
        type: 'default',
        status: 'enabled',
        sortOrder: 0,
        name: 'ChatGPT',
        url: 'https://chatgpt.com/'
      }
      getByAppIdMock.mockResolvedValueOnce(app)

      const result = await miniAppHandlers['/miniapps/:id'].GET({ params: { id: 'openai' } })

      expect(getByAppIdMock).toHaveBeenCalledWith('openai')
      expect(result).toEqual(app)
    })
  })

  describe('PATCH /miniapps/:id', () => {
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

      const result = await miniAppHandlers['/miniapps/:id'].PATCH({
        params: { id: 'custom-app' },
        body: { status: 'disabled' }
      })

      expect(updateMock).toHaveBeenCalledWith('custom-app', { status: 'disabled' })
      expect(result).toMatchObject({ status: 'disabled' })
    })

    it('should reject invalid status in PATCH body before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps/:id'].PATCH({ params: { id: 'openai' }, body: { status: 'banned' } } as never)
      ).rejects.toHaveProperty('name', 'ZodError')

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('should reject invalid region in PATCH body before calling the service', async () => {
      await expect(
        miniAppHandlers['/miniapps/:id'].PATCH({
          params: { id: 'openai' },
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
        miniAppHandlers['/miniapps/:id'].PATCH({ params: { id: 'openai' }, body: {} })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      // Empty body is valid Zod — UpdateMiniAppSchema allows all optional fields
      expect(updateMock).toHaveBeenCalledWith('openai', {})
    })
  })

  describe('DELETE /miniapps/:id', () => {
    it('should delegate to service with path id', async () => {
      deleteMock.mockResolvedValueOnce(undefined)

      await miniAppHandlers['/miniapps/:id'].DELETE({ params: { id: 'custom-app' } })

      expect(deleteMock).toHaveBeenCalledWith('custom-app')
    })
  })

  describe('DELETE /miniapps/defaults', () => {
    it('should call resetDefaults exactly once', async () => {
      resetDefaultsMock.mockResolvedValueOnce(undefined)

      await miniAppHandlers['/miniapps/defaults'].DELETE({})

      expect(resetDefaultsMock).toHaveBeenCalledTimes(1)
    })

    it('should not collide with /miniapps/:id delete', async () => {
      deleteMock.mockResolvedValueOnce(undefined)
      resetDefaultsMock.mockResolvedValueOnce(undefined)

      // Deleting a specific app by id
      await miniAppHandlers['/miniapps/:id'].DELETE({ params: { id: 'custom-app' } })
      // Resetting defaults
      await miniAppHandlers['/miniapps/defaults'].DELETE({})

      expect(deleteMock).toHaveBeenCalledWith('custom-app')
      expect(resetDefaultsMock).toHaveBeenCalledTimes(1)
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })
})
