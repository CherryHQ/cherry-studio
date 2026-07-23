/**
 * Tests for PreferenceService BootConfig routing logic.
 * Verifies that keys with 'BootConfig.' prefix are correctly routed
 * to bootConfigService instead of the DB-backed preference store.
 */
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mock from main.setup.ts — we want the REAL PreferenceService
vi.unmock('@main/data/PreferenceService')

// Mock bootConfigService
const mockBootConfigGet = vi.fn()
const mockBootConfigSet = vi.fn()
const mockBootConfigGetAll = vi.fn()

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: mockBootConfigGet,
    set: mockBootConfigSet,
    getAll: mockBootConfigGetAll
  }
}))

// Mock application.get('DbService') to return a stub with withWriteTx + getDb
const mockWithWriteTx = vi.fn()
const mockGetDb = vi.fn()
vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'DbService') {
        return { withWriteTx: mockWithWriteTx, getDb: mockGetDb }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  }
}))

// Mock lifecycle decorators to no-ops so PreferenceService can be instantiated
vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    ipcHandle = vi.fn()
    registerInterval = vi.fn(() => ({ dispose: () => {} }))
    get isReady() {
      return true
    }
  },
  Injectable: () => () => {},
  ServicePhase: () => () => {},
  DependsOn: () => () => {},
  Phase: { BeforeReady: 'BeforeReady', WhenReady: 'WhenReady' }
}))

// Mock Drizzle ORM imports used by PreferenceService
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => [a, b])
}))

// Mock preferenceTable
vi.mock('../db/schemas/preference', () => ({
  preferenceTable: { scope: 'scope', key: 'key' }
}))

const BOOT_CONFIG_KEY = 'BootConfig.app.disable_hardware_acceleration' as const
const PREFERENCE_KEY = 'app.language' as const

describe('PreferenceService BootConfig routing', () => {
  let service: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup bootConfigService mock defaults
    mockBootConfigGet.mockReturnValue(false)
    mockBootConfigGetAll.mockReturnValue({ ...DefaultBootConfig })

    // Import real PreferenceService and create instance
    const { PreferenceService } = await import('../PreferenceService')
    service = new PreferenceService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('get()', () => {
    it('routes BootConfig keys to bootConfigService', () => {
      mockBootConfigGet.mockReturnValue(true)

      const result = service.get(BOOT_CONFIG_KEY)

      expect(mockBootConfigGet).toHaveBeenCalledWith('app.disable_hardware_acceleration')
      expect(result).toBe(true)
    })

    it('routes preference keys to cache (not bootConfigService)', () => {
      const result = service.get(PREFERENCE_KEY)

      expect(mockBootConfigGet).not.toHaveBeenCalled()
      expect(result).toBe(DefaultPreferences.default[PREFERENCE_KEY])
    })
  })

  describe('set()', () => {
    it('routes BootConfig keys to bootConfigService.set', async () => {
      mockBootConfigGet.mockReturnValue(false)

      await service.set(BOOT_CONFIG_KEY, true)

      expect(mockBootConfigSet).toHaveBeenCalledWith('app.disable_hardware_acceleration', true)
    })

    it('skips write when BootConfig value is unchanged', async () => {
      mockBootConfigGet.mockReturnValue(true)

      await service.set(BOOT_CONFIG_KEY, true)

      expect(mockBootConfigSet).not.toHaveBeenCalled()
    })

    it('does not call bootConfigService for preference keys', async () => {
      // set() writes a single preference row via getDb() directly (one autocommit
      // UPDATE), so it no longer wraps withWriteTx — stub getDb, not withWriteTx.
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              run: vi.fn().mockReturnValue(undefined)
            })
          })
        })
      }
      mockGetDb.mockReturnValue(mockDb)

      await service.set(PREFERENCE_KEY, 'zh-CN')

      expect(mockBootConfigSet).not.toHaveBeenCalled()
    })
  })

  describe('setMultiple()', () => {
    it('separates BootConfig and preference updates', async () => {
      mockBootConfigGet.mockReturnValue(false)

      const mockTx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              run: vi.fn().mockReturnValue(undefined)
            })
          })
        })
      }
      mockWithWriteTx.mockImplementation((fn: any) => fn(mockTx))

      await service.setMultiple({
        [BOOT_CONFIG_KEY]: true,
        [PREFERENCE_KEY]: 'en-US'
      })

      expect(mockBootConfigSet).toHaveBeenCalledWith('app.disable_hardware_acceleration', true)
      expect(mockTx.update).toHaveBeenCalled()
    })

    it('skips unchanged BootConfig values in batch', async () => {
      mockBootConfigGet.mockReturnValue(false)

      await service.setMultiple({
        [BOOT_CONFIG_KEY]: false
      })

      expect(mockBootConfigSet).not.toHaveBeenCalled()
    })

    it('rejects the batch and skips the preference transaction when bootConfigService.set throws', async () => {
      // Value validation is owned by bootConfigService.set() (throws before any
      // state change). The bootConfig loop runs before the preference DB
      // transaction, so a schema-invalid value rejects the batch with the
      // preference part unwritten.
      mockBootConfigGet.mockReturnValue(false)
      mockBootConfigSet.mockImplementationOnce(() => {
        throw new Error('Invalid boot config value for "app.disable_hardware_acceleration"')
      })

      await expect(
        service.setMultiple({
          [BOOT_CONFIG_KEY]: true,
          [PREFERENCE_KEY]: 'en-US'
        })
      ).rejects.toThrow(/Invalid boot config value/)

      expect(mockWithWriteTx).not.toHaveBeenCalled()
    })
  })

  describe('getAll()', () => {
    it('merges preference cache with BootConfig values', () => {
      mockBootConfigGetAll.mockReturnValue({
        'app.disable_hardware_acceleration': true
      })

      const result = service.getAll()

      expect(result[PREFERENCE_KEY]).toBe(DefaultPreferences.default[PREFERENCE_KEY])
      expect(result[BOOT_CONFIG_KEY]).toBe(true)
    })
  })

  describe('getMultipleRaw()', () => {
    it('handles mixed BootConfig and preference keys', () => {
      mockBootConfigGet.mockReturnValue(true)

      const result = service.getMultipleRaw([BOOT_CONFIG_KEY, PREFERENCE_KEY])

      expect(result[BOOT_CONFIG_KEY]).toBe(true)
      expect(result[PREFERENCE_KEY]).toBe(DefaultPreferences.default[PREFERENCE_KEY])
    })
  })

  describe('internal boot config key isolation', () => {
    const INTERNAL_KEY = 'BootConfig.temp.user_data_relocation'
    const UNKNOWN_KEY = 'BootConfig.foo.does_not_exist'

    it('get() rejects internal and unknown BootConfig keys without reading them', () => {
      expect(() => service.get(INTERNAL_KEY)).toThrow(/not accessible/)
      expect(() => service.get(UNKNOWN_KEY)).toThrow(/not accessible/)
      expect(mockBootConfigGet).not.toHaveBeenCalled()
    })

    it('set() rejects an internal key before any write', async () => {
      await expect(service.set(INTERNAL_KEY, { status: 'pending' })).rejects.toThrow(/not accessible/)
      expect(mockBootConfigSet).not.toHaveBeenCalled()
    })

    it('getMultipleRaw() rejects the whole batch if any key is internal', () => {
      expect(() => service.getMultipleRaw([BOOT_CONFIG_KEY, INTERNAL_KEY])).toThrow(/not accessible/)
    })

    it('subscribeForWindow() rejects an internal key and registers nothing', () => {
      expect(() => service.subscribeForWindow(1, [INTERNAL_KEY])).toThrow(/not accessible/)
      expect(service.getSubscriptions().size).toBe(0)
    })

    it('setMultiple() rejects a mixed batch before any partial write', async () => {
      mockBootConfigGet.mockReturnValue(false)

      await expect(
        service.setMultiple({
          [BOOT_CONFIG_KEY]: true,
          [INTERNAL_KEY]: { status: 'pending' }
        })
      ).rejects.toThrow(/not accessible/)

      // Neither the BootConfig write nor the DB transaction must have run.
      expect(mockBootConfigSet).not.toHaveBeenCalled()
      expect(mockWithWriteTx).not.toHaveBeenCalled()
    })

    it('getAll() excludes internal keys from the merged result', () => {
      mockBootConfigGetAll.mockReturnValue({
        'app.disable_hardware_acceleration': true,
        'temp.user_data_relocation': { status: 'pending' }
      })

      const result = service.getAll()

      expect(result[BOOT_CONFIG_KEY]).toBe(true)
      expect(INTERNAL_KEY in result).toBe(false)
    })
  })
})
