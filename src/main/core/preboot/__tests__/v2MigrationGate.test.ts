import type { ClassifiedMigrationError } from '@data/migration/v2/diagnostics/migrationErrorClassifier'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/v2MigrationGate.ts
 *
 * The tests cover the externally observable 'handled' | 'skipped' contract,
 * the preboot diagnostics ordering, and the fixed native failure surfaces.
 *
 * Mocking strategy (mirrors chromiumFlags.test.ts):
 *   - `@data/migration/v2` is shadowed per test. The engine, window
 *     manager, and IPC handler registration functions are all backed by
 *     shared vi.fn() instances at module scope so assertions can inspect
 *     call order across test boundaries.
 *   - `@application` is shadowed per test so quit/relaunch decisions are observable.
 *   - `electron` is shadowed so `app.whenReady()` resolves synchronously and
 *     direct legacy error-box usage remains observable.
 *   - `@logger` stays on the global mock.
 */

// Shared mock instances — reset in beforeEach but their identity survives
// vi.resetModules() so assertions work across scenarios.
const initializeMock = vi.fn()
const registerMigratorsMock = vi.fn()
const needsMigrationMock = vi.fn()
const closeMock = vi.fn()
const collectDatabaseDiagnosticsMock = vi.fn()
const getAllMigratorsMock = vi.fn((): unknown[] => [])
const migrationWindowCreateMock = vi.fn()
const migrationWindowWaitForReadyMock = vi.fn()
const registerMigrationIpcHandlersMock = vi.fn()
const unregisterMigrationIpcHandlersMock = vi.fn()
const resolveMigrationPathsMock = vi.fn()
const showErrorBoxMock = vi.fn()
const appQuitMock = vi.fn()
const appRelaunchMock = vi.fn()
const whenReadyMock = vi.fn().mockResolvedValue(undefined)

const setVersionIncompatibleMock = vi.fn()
const setDataLocationNoticeMock = vi.fn()
const pinUserDataPathMock = vi.fn()
const evaluateCandidateVersionMock = vi.fn()
const diagnosticsCoordinatorConstructedMock = vi.fn()
const diagnosticsAttachPathsMock = vi.fn()
const diagnosticsBeginAttemptMock = vi.fn()
const diagnosticsRecordEventMock = vi.fn()
const diagnosticsFinishAttemptMock = vi.fn()
const diagnosticsCompleteMock = vi.fn()
const diagnosticsRunSaveMock = vi.fn()
const diagnosticBundleSaveMock = vi.fn()
const databaseDiagnosticsInspectMock = vi.fn()
const presentDiagnosticFailureMock = vi.fn()
const presentDiagnosticRecoveryMock = vi.fn()
let diagnosticsRecovered = false

const diagnosticsSnapshot = {
  version: 1,
  sessionId: 'safe-session-id',
  appVersion: '2.0.0',
  platform: 'darwin',
  arch: 'arm64',
  startedAt: '2026-07-19T10:00:00.000Z',
  state: 'active',
  attempts: []
}

const diagnosticsCoordinator = {
  get recovered() {
    return diagnosticsRecovered
  },
  attachPaths: diagnosticsAttachPathsMock,
  beginAttempt: diagnosticsBeginAttemptMock,
  recordEvent: diagnosticsRecordEventMock,
  finishAttempt: diagnosticsFinishAttemptMock,
  complete: diagnosticsCompleteMock,
  runSave: diagnosticsRunSaveMock
}

class MigrationDiagnosticsCoordinatorMock {
  constructor() {
    diagnosticsCoordinatorConstructedMock()
    return diagnosticsCoordinator
  }
}

class MigrationDiagnosticBundleBuilderMock {
  save(input: unknown) {
    return diagnosticBundleSaveMock(input)
  }
}

class MigrationDatabaseDiagnosticsMock {
  inspect(databaseFile: string) {
    return databaseDiagnosticsInspectMock(databaseFile)
  }
}

const defaultMigrationPaths = {
  userData: '/mock/userData',
  versionLogFile: '/mock/version.log',
  databaseFile: '/mock/userData/cherrystudio.sqlite',
  diagnosticsJournalFile: '/mock/userData/migration-diagnostics-v1.json'
}
const defaultResolveResult = {
  paths: defaultMigrationPaths,
  userDataChanged: false,
  inaccessibleLegacyPath: null,
  legacyDataConfirmed: false,
  dataLocation: undefined
}

function stubMigrationV2() {
  vi.doMock('@data/migration/v2', async () => {
    const { classifyMigrationError } = await vi.importActual<{
      classifyMigrationError(error: unknown): ClassifiedMigrationError
    }>('@data/migration/v2/diagnostics/migrationErrorClassifier')
    return {
      migrationEngine: {
        initialize: initializeMock,
        registerMigrators: registerMigratorsMock,
        needsMigration: needsMigrationMock,
        close: closeMock,
        collectDatabaseDiagnostics: collectDatabaseDiagnosticsMock,
        paths: { versionLogFile: '/fake/version.log', userData: '/fake/userData' }
      },
      getAllMigrators: getAllMigratorsMock,
      migrationWindowManager: {
        create: migrationWindowCreateMock,
        waitForReady: migrationWindowWaitForReadyMock
      },
      registerMigrationIpcHandlers: registerMigrationIpcHandlersMock,
      unregisterMigrationIpcHandlers: unregisterMigrationIpcHandlersMock,
      resolveMigrationPaths: resolveMigrationPathsMock,
      pinUserDataPath: pinUserDataPathMock,
      setVersionIncompatible: setVersionIncompatibleMock,
      setDataLocationNotice: setDataLocationNoticeMock,
      evaluateCandidateVersion: evaluateCandidateVersionMock,
      classifyMigrationError,
      createMigrationDiagnosticsCoordinator: () => new MigrationDiagnosticsCoordinatorMock(),
      createMigrationDiagnosticBundleBuilder: () => new MigrationDiagnosticBundleBuilderMock(),
      createMigrationDatabaseDiagnostics: () => new MigrationDatabaseDiagnosticsMock(),
      presentMigrationDiagnosticFailure: presentDiagnosticFailureMock,
      presentMigrationDiagnosticRecovery: presentDiagnosticRecoveryMock
    }
  })
}

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      whenReady: whenReadyMock,
      getVersion: vi.fn().mockReturnValue('2.0.0'),
      getLocale: vi.fn().mockReturnValue('en-US')
    },
    dialog: {
      showErrorBox: showErrorBoxMock
    }
  }))
}

function stubApplication() {
  vi.doMock('@application', () => ({
    application: {
      quit: appQuitMock,
      relaunch: appRelaunchMock
    }
  }))
}

/** Build the wrapped SQLITE_ERROR thrown when a stale DB meets fresh migration SQL. */
function schemaOutOfSyncError(): Error {
  const inner = Object.assign(new Error('table `agent` already exists'), { code: 'SQLITE_ERROR' })
  return Object.assign(new Error('SQLITE_ERROR: table `agent` already exists'), { code: 'SQLITE_ERROR', cause: inner })
}

async function loadModule() {
  return import('../v2MigrationGate')
}

beforeEach(() => {
  vi.resetModules()
  resolveMigrationPathsMock.mockReset().mockReturnValue(defaultResolveResult)
  initializeMock.mockReset().mockReturnValue(undefined)
  registerMigratorsMock.mockReset()
  needsMigrationMock.mockReset()
  closeMock.mockReset()
  collectDatabaseDiagnosticsMock.mockReset()
  getAllMigratorsMock.mockClear()
  migrationWindowCreateMock.mockReset()
  migrationWindowWaitForReadyMock.mockReset().mockResolvedValue(undefined)
  registerMigrationIpcHandlersMock.mockReset()
  unregisterMigrationIpcHandlersMock.mockReset()
  showErrorBoxMock.mockReset()
  appQuitMock.mockReset()
  appRelaunchMock.mockReset()
  whenReadyMock.mockReset().mockResolvedValue(undefined)
  setVersionIncompatibleMock.mockReset()
  setDataLocationNoticeMock.mockReset()
  pinUserDataPathMock.mockReset()
  evaluateCandidateVersionMock.mockReset()
  diagnosticsCoordinatorConstructedMock.mockReset()
  diagnosticsAttachPathsMock.mockReset()
  diagnosticsBeginAttemptMock.mockReset().mockReturnValue('attempt-id')
  diagnosticsRecordEventMock.mockReset()
  diagnosticsFinishAttemptMock.mockReset()
  diagnosticsCompleteMock.mockReset()
  diagnosticsRunSaveMock
    .mockReset()
    .mockImplementation(async (operation: (snapshot: unknown) => Promise<unknown>) => operation(diagnosticsSnapshot))
  diagnosticBundleSaveMock.mockReset().mockResolvedValue({ status: 'saved', publication: 'published' })
  databaseDiagnosticsInspectMock.mockReset().mockResolvedValue({
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'failed', code: 'lease_unavailable' }
  })
  presentDiagnosticFailureMock.mockReset().mockResolvedValue('exit')
  presentDiagnosticRecoveryMock.mockReset().mockResolvedValue('retry')
  diagnosticsRecovered = false
})

afterEach(() => {
  // See userDataLocation.test.ts — resetModules + fresh doMock per test
  // is the robust pattern, no explicit doUnmock needed.
})

describe('runV2MigrationGate', () => {
  describe('skipped path', () => {
    it("returns 'skipped' and closes the bare DB handle when no migration is needed", async () => {
      needsMigrationMock.mockResolvedValue(false)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('skipped')
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(registerMigrationIpcHandlersMock).not.toHaveBeenCalled()
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
    })

    it('registers the full migrator list against the engine', async () => {
      const migrators = [{ id: 'stub' }]
      getAllMigratorsMock.mockReturnValue(migrators)
      needsMigrationMock.mockResolvedValue(false)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(initializeMock).toHaveBeenCalledTimes(1)
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths, false, diagnosticsCoordinator)
      expect(registerMigratorsMock).toHaveBeenCalledTimes(1)
      expect(registerMigratorsMock).toHaveBeenCalledWith(migrators)
    })
  })

  describe('handled path — migration runs', () => {
    it("returns 'handled' and leaves IPC handlers registered when the migration window starts", async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      migrationWindowCreateMock.mockImplementation(() => {
        /* no-op — success */
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledWith('/mock/userData')
      expect(migrationWindowCreateMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowWaitForReadyMock).toHaveBeenCalledTimes(1)
      // Success path should NOT unregister handlers — the migration window
      // owns them until the renderer finishes migrating.
      expect(unregisterMigrationIpcHandlersMock).not.toHaveBeenCalled()
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
      // Normal-path close() must NOT fire on the handled branch.
      expect(closeMock).not.toHaveBeenCalled()
    })
  })

  describe('handled path — migration check fails', () => {
    it("returns 'handled', shows the typed native diagnostic flow, and quits when initialization fails", async () => {
      initializeMock.mockImplementation(() => {
        throw new Error('DB unavailable')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(whenReadyMock).toHaveBeenCalledTimes(1)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'database_initialize_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(JSON.stringify(presentDiagnosticFailureMock.mock.calls)).not.toContain('DB unavailable')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      // Migration path was never taken, so handlers stay un-touched.
      expect(registerMigrationIpcHandlersMock).not.toHaveBeenCalled()
      expect(unregisterMigrationIpcHandlersMock).not.toHaveBeenCalled()
      // close() must NOT fire — the try block errored before the normal path.
      expect(closeMock).not.toHaveBeenCalled()
    })

    it("returns 'handled' when needsMigration() itself throws", async () => {
      needsMigrationMock.mockRejectedValue(new Error('needsMigration failed'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'migration_status_probe_failed' })
      )
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — schema out of sync', () => {
    it('keeps a schema failure on the same safe typed presenter in dev', async () => {
      initializeMock.mockImplementation(() => {
        throw schemaOutOfSyncError()
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'database_initialize_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(JSON.stringify(presentDiagnosticFailureMock.mock.calls)).not.toContain('/mock/userData')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('uses the same safe presenter for the same schema failure in production', async () => {
      initializeMock.mockImplementation(() => {
        throw schemaOutOfSyncError()
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'database_initialize_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('does not expose a non-schema raw error or database path in dev', async () => {
      initializeMock.mockImplementation(() => {
        throw new Error('DB unavailable')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      const rendered = JSON.stringify(presentDiagnosticFailureMock.mock.calls)
      expect(rendered).not.toContain('DB unavailable')
      expect(rendered).not.toContain('/mock/userData/cherrystudio.sqlite')
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — migration window start fails', () => {
    it("returns 'handled', unregisters IPC handlers, and quits when migrationWindowManager.create() throws", async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      migrationWindowCreateMock.mockImplementation(() => {
        throw new Error('window create failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'migration_window_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it("returns 'handled' when waitForReady() rejects after window create succeeds", async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      migrationWindowWaitForReadyMock.mockRejectedValue(new Error('waitForReady rejected'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'migration_window_failed' })
      )
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — version compatibility check fails', () => {
    it("returns 'handled' and shows version_incompatible window when version check blocks", async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: {
          outcome: 'block',
          reason: 'v1_too_old',
          details: { previousVersion: '1.5.0', requiredVersion: '1.9.0' }
        },
        previousVersion: '1.5.0',
        versionLogExists: true
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      // Should show version_incompatible window, not dialog
      expect(setVersionIncompatibleMock).toHaveBeenCalledWith('v1_too_old', {
        previousVersion: '1.5.0',
        requiredVersion: '1.9.0'
      })
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowCreateMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowWaitForReadyMock).toHaveBeenCalledTimes(1)
      // Engine stays open for potential skipMigration action
      expect(closeMock).not.toHaveBeenCalled()
      // No dialog or quit — the window handles user interaction
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
    })

    it('falls back to dialog when version_incompatible window fails to create', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: {
          outcome: 'block',
          reason: 'no_version_log',
          details: { requiredVersion: '1.9.0' }
        },
        previousVersion: null,
        versionLogExists: false
      })
      migrationWindowCreateMock.mockImplementation(() => {
        throw new Error('window failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'version_window_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
    })

    it('proceeds to migration window when version check passes', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      migrationWindowCreateMock.mockImplementation(() => {
        /* no-op — success */
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(setVersionIncompatibleMock).not.toHaveBeenCalled()
      expect(migrationWindowCreateMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowWaitForReadyMock).toHaveBeenCalledTimes(1)
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(closeMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
    })
  })

  describe('inaccessible legacy path — three-option dialog', () => {
    function stubInaccessible(inaccessiblePath = '/unmounted/custom') {
      resolveMigrationPathsMock.mockReturnValue({
        paths: defaultMigrationPaths,
        userDataChanged: false,
        inaccessibleLegacyPath: inaccessiblePath,
        legacyDataConfirmed: false,
        dataLocation: undefined
      })
    }

    it('offers Retry / Use Default / Quit and relaunches on Retry (response 0)', async () => {
      stubInaccessible()
      presentDiagnosticFailureMock.mockResolvedValue('retry')
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'legacy_data_location_unavailable', allowUseDefault: true })
      )
      expect(appRelaunchMock).toHaveBeenCalledTimes(1)
      expect(pinUserDataPathMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('quits when the user chooses Quit (response 2)', async () => {
      stubInaccessible()
      presentDiagnosticFailureMock.mockResolvedValue('exit')
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(pinUserDataPathMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('pins the default dir and falls through to the normal flow on Use Default (response 1)', async () => {
      stubInaccessible()
      presentDiagnosticFailureMock.mockResolvedValue('use_default')
      needsMigrationMock.mockResolvedValue(false) // empty default → nothing to migrate
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      // No early return: pin the default, fall through, initialize on default,
      // and reach the normal skipped path.
      expect(pinUserDataPathMock).toHaveBeenCalledWith('/mock/userData')
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths, false, diagnosticsCoordinator)
      expect(appRelaunchMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
      expect(result).toBe('skipped')
    })

    it('quits with a fatal error when pinning the default dir fails on Use Default (response 1)', async () => {
      stubInaccessible()
      presentDiagnosticFailureMock.mockResolvedValueOnce('use_default').mockResolvedValueOnce('exit')
      // Strict pin persistence fails — must not silently proceed into migration
      // on an unpersisted pin (that would relaunch into the old dir and loop).
      pinUserDataPathMock.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock.mock.calls.map(([state]) => state.code)).toEqual([
        'legacy_data_location_unavailable',
        'data_location_pin_failed'
      ])
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(initializeMock).not.toHaveBeenCalled()
    })
  })

  describe('userData pin persistence failure', () => {
    it('quits with a fatal error when resolveMigrationPaths cannot persist the pin', async () => {
      // The only throwing operation in resolveMigrationPaths() is the strict
      // pinUserDataPath() persist on the redirect branch.
      resolveMigrationPathsMock.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'path_resolution_failed' })
      )
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(initializeMock).not.toHaveBeenCalled()
    })
  })

  describe('data-location notice', () => {
    it('seeds the recovered directory before registering IPC handlers on the migrate path', async () => {
      resolveMigrationPathsMock.mockReturnValue({
        paths: defaultMigrationPaths,
        userDataChanged: true,
        inaccessibleLegacyPath: null,
        legacyDataConfirmed: true,
        dataLocation: '/Volumes/Data/CherryStudio'
      })
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(setDataLocationNoticeMock).toHaveBeenCalledWith('/Volumes/Data/CherryStudio')
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
    })

    it('does not seed a notice when dataLocation is absent', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(setDataLocationNoticeMock).not.toHaveBeenCalled()
    })
  })

  describe('strict native diagnostics wiring', () => {
    it('constructs the coordinator first, attaches paths, and passes it into engine initialization', async () => {
      needsMigrationMock.mockResolvedValue(false)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(diagnosticsCoordinatorConstructedMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsCoordinatorConstructedMock.mock.invocationCallOrder[0]).toBeLessThan(
        resolveMigrationPathsMock.mock.invocationCallOrder[0]
      )
      expect(diagnosticsAttachPathsMock).toHaveBeenCalledWith(defaultMigrationPaths)
      expect(diagnosticsAttachPathsMock.mock.invocationCallOrder[0]).toBeLessThan(
        diagnosticsBeginAttemptMock.mock.invocationCallOrder[0]
      )
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths, false, diagnosticsCoordinator)
    })

    it('finishes the recovery decision before beginning a recovered retry or initializing the database', async () => {
      diagnosticsRecovered = true
      needsMigrationMock.mockResolvedValue(false)
      let resolveRecovery!: (decision: 'retry') => void
      presentDiagnosticRecoveryMock.mockImplementation(
        () =>
          new Promise<'retry'>((resolve) => {
            resolveRecovery = resolve
          })
      )
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const pendingGate = runV2MigrationGate()
      await vi.waitFor(() => expect(presentDiagnosticRecoveryMock).toHaveBeenCalledTimes(1))

      expect(diagnosticsAttachPathsMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsBeginAttemptMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()

      resolveRecovery('retry')
      await pendingGate
      expect(diagnosticsBeginAttemptMock).toHaveBeenCalledWith('recovered_retry')
      expect(presentDiagnosticRecoveryMock.mock.invocationCallOrder[0]).toBeLessThan(
        diagnosticsBeginAttemptMock.mock.invocationCallOrder[0]
      )
      expect(diagnosticsBeginAttemptMock.mock.invocationCallOrder[0]).toBeLessThan(
        initializeMock.mock.invocationCallOrder[0]
      )
    })

    it('exits from recovery without creating an attempt or initializing the database', async () => {
      diagnosticsRecovered = true
      presentDiagnosticRecoveryMock.mockResolvedValue('exit')
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsBeginAttemptMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('reconciles a completed database only after the status probe and then clears the stale journal', async () => {
      diagnosticsRecovered = true
      presentDiagnosticRecoveryMock.mockResolvedValue('retry')
      needsMigrationMock.mockResolvedValue(false)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('skipped')
      expect(diagnosticsFinishAttemptMock).toHaveBeenCalledWith(
        'completed',
        expect.objectContaining({ scope: 'gate', phase: 'finalize', state: 'completed' })
      )
      expect(needsMigrationMock.mock.invocationCallOrder[0]).toBeLessThan(
        diagnosticsFinishAttemptMock.mock.invocationCallOrder[0]
      )
      expect(diagnosticsFinishAttemptMock.mock.invocationCallOrder[0]).toBeLessThan(
        diagnosticsCompleteMock.mock.invocationCallOrder[0]
      )
      expect(presentDiagnosticFailureMock).not.toHaveBeenCalled()
    })

    it('can save a minimal memory-only bundle when path resolution fails', async () => {
      resolveMigrationPathsMock.mockImplementation(() => {
        throw new Error('Bearer private-key /Users/private')
      })
      let saveResult: unknown
      presentDiagnosticFailureMock.mockImplementation(
        async (state: { code: string; saveBundle: (destination: string) => Promise<unknown> }) => {
          saveResult = await state.saveBundle('/safe/memory-only.zip')
          return 'exit'
        }
      )
      diagnosticBundleSaveMock.mockImplementation(
        async (input: { collectDatabaseDiagnostics: () => Promise<unknown> }) => {
          expect(await input.collectDatabaseDiagnostics()).toEqual({
            version: 1,
            expectedSchemaVersion: 1,
            completion: { status: 'failed', code: 'lease_unavailable' }
          })
          return { status: 'saved', publication: 'published' }
        }
      )
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(saveResult).toEqual({ status: 'saved' })
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'path_resolution_failed', locale: 'en-US' })
      )
      expect(initializeMock).not.toHaveBeenCalled()
      const rendered = JSON.stringify(presentDiagnosticFailureMock.mock.calls)
      expect(rendered).not.toContain('private-key')
      expect(rendered).not.toContain('/Users/private')
    })

    it.each([
      {
        expectedCode: 'diagnostics_journal_failed',
        configure: () =>
          diagnosticsAttachPathsMock.mockImplementation(() => {
            throw new Error('journal')
          })
      },
      {
        expectedCode: 'database_initialize_failed',
        configure: () =>
          initializeMock.mockImplementation(() => {
            throw new Error('initialize')
          })
      },
      {
        expectedCode: 'migration_status_probe_failed',
        configure: () => needsMigrationMock.mockRejectedValue(new Error('status'))
      },
      {
        expectedCode: 'version_check_failed',
        configure: () => {
          needsMigrationMock.mockResolvedValue(true)
          evaluateCandidateVersionMock.mockImplementation(() => {
            throw new Error('version')
          })
        }
      },
      {
        expectedCode: 'version_window_failed',
        configure: () => {
          needsMigrationMock.mockResolvedValue(true)
          evaluateCandidateVersionMock.mockReturnValue({
            check: { outcome: 'block', reason: 'no_version_log', details: { requiredVersion: '1.9.12' } },
            previousVersion: null,
            versionLogExists: false
          })
          migrationWindowCreateMock.mockImplementation(() => {
            throw new Error('version window')
          })
        }
      },
      {
        expectedCode: 'migration_window_failed',
        configure: () => {
          needsMigrationMock.mockResolvedValue(true)
          evaluateCandidateVersionMock.mockReturnValue({
            check: { outcome: 'pass' },
            previousVersion: '1.9.12',
            versionLogExists: true
          })
          migrationWindowCreateMock.mockImplementation(() => {
            throw new Error('migration window')
          })
        }
      }
    ])('routes $expectedCode through the same typed presenter', async ({ expectedCode, configure }) => {
      configure()
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(expect.objectContaining({ code: expectedCode }))
    })

    it('routes a pin failure through the typed presenter without exposing the raw failure', async () => {
      resolveMigrationPathsMock.mockReturnValue({
        ...defaultResolveResult,
        inaccessibleLegacyPath: '/private/legacy'
      })
      presentDiagnosticFailureMock.mockResolvedValueOnce('use_default').mockResolvedValueOnce('exit')
      pinUserDataPathMock.mockImplementation(() => {
        throw new Error('password=private')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(presentDiagnosticFailureMock.mock.calls.map(([state]) => state.code)).toEqual([
        'legacy_data_location_unavailable',
        'data_location_pin_failed'
      ])
      expect(JSON.stringify(presentDiagnosticFailureMock.mock.calls)).not.toContain('password=private')
    })

    it('passes a typed renderer failure callback to the migration window', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const options = migrationWindowCreateMock.mock.calls[0]?.[0] as
        | { onRendererFailure?: (reason: 'renderer_process_gone') => Promise<void> }
        | undefined
      expect(options?.onRendererFailure).toBeTypeOf('function')

      await options!.onRendererFailure!('renderer_process_gone')
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'renderer_process_gone' })
      )
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })
})
