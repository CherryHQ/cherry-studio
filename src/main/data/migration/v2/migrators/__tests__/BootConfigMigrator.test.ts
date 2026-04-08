/**
 * Tests for BootConfigMigrator.
 *
 * Focuses on the 'configfile' source branch added for migrating v1
 * ~/.cherrystudio/config/config.json → boot-config's `app.user_data_path`,
 * plus a regression test covering the existing redux source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'

// Mock bootConfigService — the migrator writes via .set() and .flush(), then
// validates via .get(). We spy on the mutations and stub the reads.
const bootConfigStore: Record<string, unknown> = {}
const mockBootConfigSet = vi.fn((key: string, value: unknown) => {
  bootConfigStore[key] = value
})
const mockBootConfigGet = vi.fn((key: string) => bootConfigStore[key])
const mockBootConfigFlush = vi.fn()

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    set: mockBootConfigSet,
    get: mockBootConfigGet,
    flush: mockBootConfigFlush
  }
}))

/**
 * Build a minimal MigrationContext mock carrying only the sources that
 * BootConfigMigrator actually consumes. Individual tests override specific
 * sources via the `overrides` parameter.
 */
function createMockContext(overrides?: {
  redux?: Record<string, unknown>
  legacyHomeConfig?: Record<string, string> | null
}) {
  const reduxState = new ReduxStateReader(overrides?.redux ?? {})

  const legacyHomeConfig = {
    getUserDataPath: vi.fn(() => (overrides && 'legacyHomeConfig' in overrides ? overrides.legacyHomeConfig : null))
  }

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState,
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() },
      localStorage: { get: vi.fn(), has: vi.fn(), keys: vi.fn(), size: 0 },
      legacyHomeConfig
    },
    db: {} as any,
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  } as any
}

describe('BootConfigMigrator', () => {
  beforeEach(async () => {
    // Reset in-memory store and all mock calls between tests
    for (const key of Object.keys(bootConfigStore)) delete bootConfigStore[key]
    vi.clearAllMocks()
  })

  async function createMigrator() {
    const { BootConfigMigrator } = await import('../BootConfigMigrator')
    const migrator = new BootConfigMigrator()
    migrator.setProgressCallback(vi.fn())
    return migrator
  }

  describe('metadata', () => {
    it('has stable id/name/order matching the registered migrator', async () => {
      const migrator = await createMigrator()
      expect(migrator.id).toBe('bootConfig')
      expect(migrator.name).toBe('Boot Config')
      expect(migrator.order).toBe(0.5)
    })
  })

  describe('configfile source — prepare/execute/validate', () => {
    it('prepares and executes a legacy-string derived record', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        legacyHomeConfig: { '/Applications/Cherry Studio.app/exe': '/Volumes/Ext/Data' }
      })

      const prepared = await migrator.prepare(ctx)
      expect(prepared.success).toBe(true)
      // Redux 'disableHardwareAcceleration' is missing → falls back to default (false).
      // Config-file 'appDataPath' parsed → becomes a real item.
      // Both count toward itemCount.
      expect(prepared.itemCount).toBeGreaterThanOrEqual(1)

      const executed = await migrator.execute()
      expect(executed.success).toBe(true)

      // C1-critical: directly assert the value structure — validate() alone
      // can't be trusted for Record-typed keys (see §4.5 in the plan).
      expect(mockBootConfigSet).toHaveBeenCalledWith('app.user_data_path', {
        '/Applications/Cherry Studio.app/exe': '/Volumes/Ext/Data'
      })
      expect(mockBootConfigFlush).toHaveBeenCalled()
    })

    it('skips the configfile source when reader returns null (no v1 config file)', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({ legacyHomeConfig: null })

      const prepared = await migrator.prepare(ctx)
      expect(prepared.success).toBe(true)

      await migrator.execute()

      // The configfile key must NOT have been written. Other sources (if any
      // run with defaults) may still call set, but not for app.user_data_path.
      const configFileCalls = mockBootConfigSet.mock.calls.filter(([key]) => key === 'app.user_data_path')
      expect(configFileCalls).toHaveLength(0)
    })

    it('skips the configfile source on edge case: reader returns null for empty array', async () => {
      // When the v1 file has `appDataPath: []`, LegacyHomeConfigReader returns
      // null (tested in LegacyHomeConfigReader.test.ts). The migrator then
      // hits the shared null-skip guard and never writes app.user_data_path.
      // This test locks in the migrator's side of that contract.
      const migrator = await createMigrator()
      const ctx = createMockContext({ legacyHomeConfig: null })

      await migrator.prepare(ctx)
      await migrator.execute()

      expect(mockBootConfigSet).not.toHaveBeenCalledWith('app.user_data_path', expect.anything())
    })

    it('converts an array-derived record and writes it verbatim', async () => {
      const migrator = await createMigrator()
      const multiInstall = {
        '/Applications/Cherry Studio.app/exe': '/Volumes/Ext1/Data',
        '/Applications/Cherry Studio Dev.app/exe': '/Volumes/Ext2/DevData'
      }
      const ctx = createMockContext({ legacyHomeConfig: multiInstall })

      await migrator.prepare(ctx)
      await migrator.execute()

      expect(mockBootConfigSet).toHaveBeenCalledWith('app.user_data_path', multiInstall)
    })
  })

  describe('redux source regression', () => {
    it('still migrates disableHardwareAcceleration from redux settings', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        redux: { settings: { disableHardwareAcceleration: true } },
        legacyHomeConfig: null
      })

      await migrator.prepare(ctx)
      await migrator.execute()

      expect(mockBootConfigSet).toHaveBeenCalledWith('app.disable_hardware_acceleration', true)
    })
  })

  describe('reset', () => {
    it('clears prepared items and skipped count between runs', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        legacyHomeConfig: { '/exe': '/data' }
      })

      await migrator.prepare(ctx)
      migrator.reset()

      // After reset, an empty-context prepare should produce 0 configfile items
      // (redux default still counts as 1 for disableHardwareAcceleration).
      const prepared2 = await migrator.prepare(createMockContext({ legacyHomeConfig: null }))
      expect(prepared2.success).toBe(true)

      await migrator.execute()

      const configFileCalls = mockBootConfigSet.mock.calls.filter(([key]) => key === 'app.user_data_path')
      expect(configFileCalls).toHaveLength(0)
    })
  })
})
