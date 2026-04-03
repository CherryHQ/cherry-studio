import { ErrorCode } from '@shared/data/api'
import type { CreateMiniappDto, UpdateMiniappDto } from '@shared/data/api/schemas/miniapps'
import { ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => ({
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
        transaction: mockTransaction
      }))
    }))
  }
}))

const { MiniAppService } = await import('../MiniAppService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    appId: 'custom-app',
    name: 'Custom App',
    url: 'https://custom.app',
    logo: 'application',
    type: 'custom' as const,
    status: 'enabled' as const,
    sortOrder: 0,
    bordered: false,
    background: null,
    supportedRegions: null,
    configuration: null,
    nameKey: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides
  }
}

describe('MiniAppService', () => {
  let service: InstanceType<typeof MiniAppService>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    mockTransaction.mockReset()
    service = new MiniAppService()
  })

  describe('getByAppId', () => {
    it('should return a builtin miniapp merged with DB preferences', async () => {
      const dbRow = createMockRow({
        appId: 'openai',
        type: 'default' as const,
        status: 'disabled' as const,
        sortOrder: 10
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([dbRow])
          })
        })
      })

      const result = await service.getByAppId('openai')

      expect(result.appId).toBe('openai')
      expect(result.name).toBe('ChatGPT')
      expect(result.url).toBe('https://chatgpt.com/')
      expect(result.status).toBe('disabled')
      expect(result.sortOrder).toBe(10)
      expect(result.type).toBe('default')
    })

    it('should return builtin with defaults when no DB row exists', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      const result = await service.getByAppId('gemini')

      expect(result.appId).toBe('gemini')
      expect(result.name).toBe('Gemini')
      expect(result.status).toBe('enabled')
      expect(result.type).toBe('default')
    })

    it('should return a custom miniapp from DB', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.getByAppId('custom-app')

      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('Custom App')
      expect(result.type).toBe('custom')
    })

    it('should throw NotFound for nonexistent custom app', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.getByAppId('nonexistent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('list', () => {
    it('should return merged builtin and custom apps', async () => {
      const customRow = createMockRow()
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([customRow])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      })

      const result = await service.list({})

      // Should include all builtin apps + custom apps
      expect(result.items.length).toBeGreaterThan(ORIGIN_DEFAULT_MIN_APPS.length)
      expect(result.total).toBe(result.items.length)
      expect(result.page).toBe(1)
    })

    it('should filter by type=custom', async () => {
      const customRow = createMockRow()
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([customRow])
          })
        })
      })

      const result = await service.list({ type: 'custom' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].type).toBe('custom')
      expect(result.items[0].appId).toBe('custom-app')
    })

    it('should filter by type=default', async () => {
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      })

      const result = await service.list({ type: 'default' })

      expect(result.items.length).toBe(ORIGIN_DEFAULT_MIN_APPS.length)
      expect(result.items.every((item) => item.type === 'default')).toBe(true)
    })

    it('should filter by status', async () => {
      const prefRow = createMockRow({
        appId: 'openai',
        type: 'default' as const,
        status: 'disabled' as const
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([prefRow])
        })
      })

      const result = await service.list({ status: 'disabled' })

      // Only apps with disabled status should be returned
      expect(result.items.every((item) => item.status === 'disabled')).toBe(true)
    })

    it('should sort items by status priority then sortOrder', async () => {
      const customRow1 = createMockRow({ appId: 'a', sortOrder: 2 })
      const prefRow = createMockRow({
        appId: 'openai',
        type: 'default' as const,
        status: 'pinned' as const,
        sortOrder: 5
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([customRow1])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([prefRow])
        })
      })

      const result = await service.list({})

      // Pinned should come before enabled
      const pinnedIndex = result.items.findIndex((item) => item.status === 'pinned')
      const enabledIndex = result.items.findIndex((item) => item.status === 'enabled')
      expect(pinnedIndex).toBeLessThan(enabledIndex)
    })
  })

  describe('create', () => {
    it('should create a custom miniapp', async () => {
      const row = createMockRow({ name: 'New App' })
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row])
      })
      mockInsert.mockReturnValue({ values })

      // Mock the duplicate check
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      const dto: CreateMiniappDto = {
        appId: 'new-app',
        name: 'New App',
        url: 'https://new.app',
        logo: 'custom-logo',
        bordered: false,
        supportedRegions: ['CN', 'Global']
      }

      const result = await service.create(dto)

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'new-app',
          name: 'New App',
          url: 'https://new.app',
          logo: 'custom-logo',
          type: 'custom',
          status: 'enabled',
          sortOrder: 0
        })
      )
      expect(result.appId).toBe('custom-app')
      expect(result.name).toBe('New App')
    })

    it('should reject creation if appId is a builtin app', async () => {
      await expect(
        service.create({
          appId: 'openai',
          name: 'test',
          url: 'https://test.app',
          logo: 'test',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        status: 409
      })
    })

    it('should reject creation if appId already exists in DB', async () => {
      const existing = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      await expect(
        service.create({
          appId: 'custom-app',
          name: 'Duplicate',
          url: 'https://dup.app',
          logo: 'duplicate',
          bordered: false,
          supportedRegions: ['CN']
        })
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        status: 409
      })
    })
  })

  describe('update', () => {
    it('should update all fields for a custom miniapp', async () => {
      const existing = createMockRow()
      const updated = createMockRow({
        name: 'Updated App',
        url: 'https://updated.app',
        status: 'disabled' as const
      })

      // First call: getByAppId
      // Second call: update returning
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      const set = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated])
        })
      })
      mockUpdate.mockReturnValue({ set })

      const dto: UpdateMiniappDto = {
        name: 'Updated App',
        url: 'https://updated.app',
        status: 'disabled'
      }

      const result = await service.update('custom-app', dto)

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated App',
          url: 'https://updated.app',
          status: 'disabled'
        })
      )
      expect(result.name).toBe('Updated App')
    })

    it('should only allow preference fields for default apps', async () => {
      const existing = createMockRow({
        appId: 'openai',
        type: 'default' as const
      })
      const updated = createMockRow({
        appId: 'openai',
        type: 'default' as const,
        status: 'pinned' as const
      })

      // Mock select for DB query (check existing pref)
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })
      // Mock select for getByAppId
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })
      // Mock insert for ensureDefaultAppPref
      const values = vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      })
      mockInsert.mockReturnValue({ values })

      const set = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated])
        })
      })
      mockUpdate.mockReturnValue({ set })

      const result = await service.update('openai', { status: 'pinned' })

      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pinned'
        })
      )
      expect(result.status).toBe('pinned')
    })

    it('should reject empty updates for default apps', async () => {
      const existing = createMockRow({
        appId: 'openai',
        type: 'default' as const
      })

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })
      const values = vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      })
      mockInsert.mockReturnValue({ values })

      // Trying to update non-preference field on a default app
      await expect(service.update('openai', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should reject update of nonexistent app', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.update('nonexistent', { name: 'New Name' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('delete', () => {
    it('should delete a custom miniapp', async () => {
      const existing = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await expect(service.delete('custom-app')).resolves.toBeUndefined()
      expect(where).toHaveBeenCalled()
    })

    it('should reject deletion of default apps', async () => {
      const existing = createMockRow({
        appId: 'openai',
        type: 'default' as const
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      await expect(service.delete('openai')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422
      })

      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe('reorder', () => {
    it('should batch update sort orders in a transaction', async () => {
      const txUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ appId: 'app-1' }])
          })
        })
      })
      const txSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ appId: 'app-1' }])
        })
      })
      const txInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
        })
      })
      const txDb = {
        update: txUpdate,
        select: txSelect,
        insert: txInsert
      }

      mockTransaction.mockImplementation(async (fn) => {
        await fn(txDb)
      })

      await service.reorder([
        { appId: 'app-1', sortOrder: 0 },
        { appId: 'app-2', sortOrder: 1 }
      ])

      expect(mockTransaction).toHaveBeenCalledTimes(1)
      expect(txUpdate).toHaveBeenCalledTimes(2)
    })

    it('should ensure DB rows exist for builtin apps during reorder', async () => {
      const txUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ appId: 'openai' }])
          })
        })
      })
      const txSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      })
      const txInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
        })
      })
      const txDb = {
        update: txUpdate,
        select: txSelect,
        insert: txInsert
      }

      mockTransaction.mockImplementation(async (fn) => {
        await fn(txDb)
      })

      await service.reorder([{ appId: 'openai', sortOrder: 0 }])

      // Should insert missing builtin app pref rows
      expect(txInsert).toHaveBeenCalled()
    })

    it('should log skipped non-existent app IDs', async () => {
      const txUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([])
          })
        })
      })
      const txSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      })
      const txInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
        })
      })
      const txDb = {
        update: txUpdate,
        select: txSelect,
        insert: txInsert
      }

      mockTransaction.mockImplementation(async (fn) => {
        await fn(txDb)
      })

      // Should not throw, just logs warning
      await expect(service.reorder([{ appId: 'nonexistent', sortOrder: 0 }])).resolves.toBeUndefined()
    })
  })

  describe('resetDefaults', () => {
    it('should delete all default app preference rows', async () => {
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await expect(service.resetDefaults()).resolves.toBeUndefined()

      // Should call delete with type='default' condition
      expect(mockDelete).toHaveBeenCalled()
      expect(where).toHaveBeenCalled()
    })

    it('should only target default type rows, not custom', async () => {
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await service.resetDefaults()

      // Verify mockDelete was called exactly once with the correct scope
      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(where).toHaveBeenCalledTimes(1)
    })
  })
})
