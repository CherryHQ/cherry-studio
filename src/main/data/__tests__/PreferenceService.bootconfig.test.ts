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

// Mock lifecycle decorators to no-ops so PreferenceService can be instantiated
vi.mock('@main/core/lifecycle', () => ({
  BaseService: class {
    ipcHandle = vi.fn()
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

// Mock db types
vi.mock('../db/types', () => ({}))

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
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      })
      service.db = { update: mockUpdate }

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
            where: vi.fn().mockResolvedValue(undefined)
          })
        })
      }
      service.db = {
        transaction: vi.fn(async (fn: any) => fn(mockTx))
      }

      await service.setMultiple({
        [BOOT_CONFIG_KEY]: true,
        [PREFERENCE_KEY]: 'en-US'
      })

      expect(mockBootConfigSet).toHaveBeenCalledWith('app.disable_hardware_acceleration', true)
      expect(mockTx.update).toHaveBeenCalled()
    })

    it('skips unchanged BootConfig values in batch', async () => {
      mockBootConfigGet.mockReturnValue(false)

      service.db = {
        transaction: vi.fn(async (fn: any) => fn({ update: vi.fn() }))
      }

      await service.setMultiple({
        [BOOT_CONFIG_KEY]: false
      })

      expect(mockBootConfigSet).not.toHaveBeenCalled()
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
})
