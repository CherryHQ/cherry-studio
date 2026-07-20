/**
 * Tests for BootConfigMigrator.
 *
 * Focuses on the 'configfile' source branch added for migrating v1
 * ~/.cherrystudio/config/config.json → boot-config's `app.user_data_path`,
 * plus a regression test covering the existing redux source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'

// Mock bootConfigService — the migrator writes via .set() and .persist() (the
// strict, throwing flush variant), then validates via .get(). We spy on the
// mutations and stub the reads.
const bootConfigStore: Record<string, unknown> = {}
const mockBootConfigSet = vi.fn((key: string, value: unknown) => {
  bootConfigStore[key] = value
})
const mockBootConfigGet = vi.fn((key: string) => bootConfigStore[key])
const mockBootConfigPersist = vi.fn()

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    set: mockBootConfigSet,
    get: mockBootConfigGet,
    persist: mockBootConfigPersist
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
      expect(mockBootConfigPersist).toHaveBeenCalled()
    })

    it('preserves a fixed classification when persisting boot config fails and clears it on retry', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        legacyHomeConfig: { '/Applications/Cherry Studio.app/exe': '/Volumes/Ext/Data' }
      })
      const canary = 'PRIVATE_BOOT_CONFIG_PATH_/Users/alice/boot-config.json'

      await migrator.prepare(ctx)

      mockBootConfigPersist.mockImplementationOnce(() => {
        throw Object.assign(new Error(canary), { code: 'ENOSPC' })
      })

      const failed = await migrator.executeWithDiagnostics(ctx)
      const retried = await migrator.executeWithDiagnostics(ctx)

      expect(failed).toMatchObject({
        result: { success: false, error: canary },
        failure: { classification: { errorCode: 'file_io' } }
      })
      expect(JSON.stringify(failed.failure)).not.toContain(canary)
      expect(retried).toEqual({ result: expect.objectContaining({ success: true }) })
      expect(retried).not.toHaveProperty('failure')
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

  describe('configfile source — preserves preboot-pinned current-exe entry', () => {
    // Regression for the pin-clobber bug: the migration gate's preboot step
    // (pinUserDataPath) writes app.user_data_path[currentExe] → recovered dir
    // BEFORE migration runs. In the real bug scenario (v1 exe path changed),
    // the legacy config is keyed by the OLD exe, so a wholesale set() would
    // drop the freshly-pinned current-exe entry and, after relaunch, the app
    // would miss its own migrated directory. The migrator must MERGE, keeping
    // existing (pinned) entries.
    const CURRENT_EXE = '/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio'
    const OLD_EXE = '/Applications/CherryStudio.app/Contents/MacOS/CherryStudio'
    const RECOVERED_DIR = '/Volumes/Ext/CherryData'

    it('merges the legacy record with an existing entry keyed by a different exe', async () => {
      // Seed the preboot pin (current exe → recovered dir).
      bootConfigStore['app.user_data_path'] = { [CURRENT_EXE]: RECOVERED_DIR }

      const migrator = await createMigrator()
      // Legacy config records the SAME dir but under the OLD exe path.
      const ctx = createMockContext({ legacyHomeConfig: { [OLD_EXE]: RECOVERED_DIR } })

      await migrator.prepare(ctx)
      await migrator.execute()

      // Both keys survive; the pinned current-exe entry is NOT dropped.
      expect(bootConfigStore['app.user_data_path']).toEqual({
        [CURRENT_EXE]: RECOVERED_DIR,
        [OLD_EXE]: RECOVERED_DIR
      })
    })

    it('lets the existing (pinned) entry win on a key conflict', async () => {
      // Same exe key present in both boot-config (pin) and legacy record but
      // pointing at different dirs — the authoritative pin must be preserved.
      bootConfigStore['app.user_data_path'] = { [CURRENT_EXE]: RECOVERED_DIR }

      const migrator = await createMigrator()
      const ctx = createMockContext({ legacyHomeConfig: { [CURRENT_EXE]: '/stale/legacy/dir' } })

      await migrator.prepare(ctx)
      await migrator.execute()

      expect(bootConfigStore['app.user_data_path']).toEqual({ [CURRENT_EXE]: RECOVERED_DIR })
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

  describe('schema validation in prepare', () => {
    it('skips a corrupt v1 value with a warning and still migrates valid items', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        // Wrong type: v1 stored a string where the schema requires a boolean.
        redux: { settings: { disableHardwareAcceleration: 'yes' } },
        legacyHomeConfig: { '/exe': '/data' }
      })

      const prepared = await migrator.prepare(ctx)
      expect(prepared.success).toBe(true)
      expect(prepared.warnings?.some((w) => w.includes('schema validation'))).toBe(true)

      const executed = await migrator.execute()
      expect(executed.success).toBe(true)

      // The corrupt boolean must not be written; the valid record still is.
      const hwCalls = mockBootConfigSet.mock.calls.filter(([key]) => key === 'app.disable_hardware_acceleration')
      expect(hwCalls).toHaveLength(0)
      expect(mockBootConfigSet).toHaveBeenCalledWith('app.user_data_path', { '/exe': '/data' })
    })

    it('skips a corrupt legacy user_data_path record', async () => {
      const migrator = await createMigrator()
      const ctx = createMockContext({
        // v1 config.json is untrusted: a non-string value sneaks past the reader's type.
        legacyHomeConfig: { '/exe': 123 } as unknown as Record<string, string>
      })

      const prepared = await migrator.prepare(ctx)
      expect(prepared.success).toBe(true)
      expect(prepared.warnings?.some((w) => w.includes('schema validation'))).toBe(true)

      await migrator.execute()

      const configFileCalls = mockBootConfigSet.mock.calls.filter(([key]) => key === 'app.user_data_path')
      expect(configFileCalls).toHaveLength(0)
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
