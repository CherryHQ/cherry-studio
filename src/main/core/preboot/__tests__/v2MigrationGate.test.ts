import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/v2MigrationGate.ts
 *
 * This module is deliberately a pure move of previously inlined
 * index.ts:140-186 logic, so the tests focus on the new externally
 * observable contract: the 'handled' | 'skipped' return value across
 * the four decision branches.
 *
 * Mocking strategy (mirrors chromiumFlags.test.ts):
 *   - `@data/migration/v2` is shadowed per test. The engine, window
 *     manager, and IPC handler registration functions are all backed by
 *     shared vi.fn() instances at module scope so assertions can inspect
 *     call order across test boundaries.
 *   - `@application` is globally mocked in tests/main.setup.ts
 *     but the global mock has no `quit()`; we shadow it per test with a
 *     factory that provides a spy-able `quit`.
 *   - `electron` is shadowed so `app.whenReady()` resolves synchronously
 *     and `dialog.showErrorBox` is an observable spy. The global electron
 *     mock has `dialog.showErrorBox` already but not `app.whenReady`.
 *   - `@logger` stays on the global mock.
 */

// Shared mock instances — reset in beforeEach but their identity survives
// vi.resetModules() so assertions work across scenarios.
const initializeMock = vi.fn()
const registerMigratorsMock = vi.fn()
const needsMigrationMock = vi.fn()
const closeMock = vi.fn()
const getAllMigratorsMock = vi.fn((): unknown[] => [])
const migrationWindowCreateMock = vi.fn()
const migrationWindowWaitForReadyMock = vi.fn()
const registerMigrationIpcHandlersMock = vi.fn()
const unregisterMigrationIpcHandlersMock = vi.fn()
const resolveMigrationPathsMock = vi.fn()
const showErrorBoxMock = vi.fn()
const showMessageBoxMock = vi.fn()
const presentMigrationDiagnosticFailureMock = vi.fn()
const appQuitMock = vi.fn()
const appRelaunchMock = vi.fn()
const whenReadyMock = vi.fn().mockResolvedValue(undefined)
const getLocaleMock = vi.fn().mockReturnValue('en-US')
const relaunchMock = vi.fn()
const exitMock = vi.fn()

const setVersionIncompatibleMock = vi.fn()
const setDataLocationNoticeMock = vi.fn()
const pinUserDataPathMock = vi.fn()
const evaluateCandidateVersionMock = vi.fn()
const getBlockMessageMock = vi.fn()

const defaultMigrationPaths = {
  userData: '/mock/userData',
  migrationTempDir: '/mock/userData/migration_temp',
  dexieExportDir: '/mock/userData/migration_temp/dexie_export',
  localStorageExportFile: '/mock/userData/migration_temp/localstorage_export/localStorage.json',
  versionLogFile: '/mock/version.log',
  databaseFile: '/mock/userData/cherrystudio.sqlite'
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
    // The gate now imports the version-policy fns and isSchemaOutOfSyncError through
    // the barrel, so they live on this mock. isSchemaOutOfSyncError is a pure predicate —
    // keep the real implementation so schemaOutOfSyncError() fixtures are still detected.
    const { isSchemaOutOfSyncError } = (await vi.importActual('@data/migration/v2/core/migrationErrors')) as {
      isSchemaOutOfSyncError: (error: unknown) => boolean
    }
    return {
      migrationEngine: {
        initialize: initializeMock,
        registerMigrators: registerMigratorsMock,
        needsMigration: needsMigrationMock,
        close: closeMock,
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
      getBlockMessage: getBlockMessageMock,
      presentMigrationDiagnosticFailure: presentMigrationDiagnosticFailureMock,
      isSchemaOutOfSyncError
    }
  })
}

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      whenReady: whenReadyMock,
      relaunch: relaunchMock,
      exit: exitMock,
      getVersion: vi.fn().mockReturnValue('2.0.0'),
      getLocale: getLocaleMock
    },
    dialog: {
      showErrorBox: showErrorBoxMock,
      showMessageBox: showMessageBoxMock
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

function stubPlatform(isDev: boolean) {
  vi.doMock('@main/core/platform', () => ({ isDev }))
}

/** Build the wrapped SQLITE_ERROR thrown when a stale DB meets fresh migration SQL. */
function schemaOutOfSyncError(): Error {
  const inner = Object.assign(new Error('table `agent` already exists'), { code: 'SQLITE_ERROR' })
  return Object.assign(new Error('SQLITE_ERROR: table `agent` already exists'), { code: 'SQLITE_ERROR', cause: inner })
}

async function loadModule() {
  return import('../v2MigrationGate')
}

function expectNativeDiagnosticFailure(failureCode: string, errorSummary: string) {
  expect(presentMigrationDiagnosticFailureMock).toHaveBeenCalledTimes(1)
  const [presentation] = presentMigrationDiagnosticFailureMock.mock.calls[0]
  expect(presentation).toMatchObject({
    locale: 'en-US',
    context: {
      source: 'native',
      stage: 'preboot',
      errorSummary,
      failure: { code: failureCode, origin: 'main' }
    }
  })
  expect(presentation.context).not.toHaveProperty('failureCode')
  expect(presentation.context).not.toHaveProperty('error')
  return presentation.failure
}

beforeEach(() => {
  vi.resetModules()
  resolveMigrationPathsMock.mockReset().mockReturnValue(defaultResolveResult)
  initializeMock.mockReset().mockReturnValue(undefined)
  registerMigratorsMock.mockReset()
  needsMigrationMock.mockReset()
  closeMock.mockReset()
  getAllMigratorsMock.mockClear()
  migrationWindowCreateMock.mockReset()
  migrationWindowWaitForReadyMock.mockReset().mockResolvedValue(undefined)
  registerMigrationIpcHandlersMock.mockReset()
  unregisterMigrationIpcHandlersMock.mockReset()
  showErrorBoxMock.mockReset()
  showMessageBoxMock.mockReset()
  presentMigrationDiagnosticFailureMock.mockReset().mockResolvedValue(0)
  appQuitMock.mockReset()
  appRelaunchMock.mockReset()
  whenReadyMock.mockReset().mockResolvedValue(undefined)
  getLocaleMock.mockReset().mockReturnValue('en-US')
  relaunchMock.mockReset()
  exitMock.mockReset()
  setVersionIncompatibleMock.mockReset()
  setDataLocationNoticeMock.mockReset()
  pinUserDataPathMock.mockReset()
  evaluateCandidateVersionMock.mockReset()
  getBlockMessageMock.mockReset()
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
      expect(presentMigrationDiagnosticFailureMock).not.toHaveBeenCalled()
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
      // Now threads the gate-resolved legacyDataConfirmed flag into the engine.
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths, false)
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
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledWith(defaultMigrationPaths)
      expect(migrationWindowCreateMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowWaitForReadyMock).toHaveBeenCalledTimes(1)
      // Success path should NOT unregister handlers — the migration window
      // owns them until the renderer finishes migrating.
      expect(unregisterMigrationIpcHandlersMock).not.toHaveBeenCalled()
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(presentMigrationDiagnosticFailureMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
      // Normal-path close() must NOT fire on the handled branch.
      expect(closeMock).not.toHaveBeenCalled()
    })
  })

  describe('handled path — migration check fails', () => {
    it("returns 'handled', shows an error dialog, and quits when the engine fails to initialize", async () => {
      const initializationError = Object.assign(new Error('DB unavailable'), {
        stack: 'Error: DB unavailable\n    at initialize (/app/main.js:18:5)',
        code: 'SQLITE_CANTOPEN',
        path: '/mock/userData/cherrystudio.sqlite'
      })
      initializeMock.mockImplementation(() => {
        throw initializationError
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubPlatform(false)

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(whenReadyMock).toHaveBeenCalledTimes(1)
      const failure = expectNativeDiagnosticFailure(
        'database_initialize_failed',
        'Could not initialize the migration database.'
      )
      expect(failure.title).toContain('Migration Failed')
      expect(failure.title).not.toContain('(Dev)')
      expect(failure.message).toContain('DB unavailable')
      // Regression: the old fallback mislabeled every failure as a DB "connectivity issue".
      expect(failure.message).not.toContain('connectivity')
      expect(failure).toMatchObject({ type: 'error', buttons: ['Quit'], defaultId: 0, cancelId: 0 })
      expect(presentMigrationDiagnosticFailureMock.mock.calls[0]?.[0].context.failure.error).toEqual({
        name: 'Error',
        message: 'DB unavailable',
        stack: 'Error: DB unavailable\n    at initialize (/app/main.js:18:5)',
        code: 'SQLITE_CANTOPEN',
        path: '/mock/userData/cherrystudio.sqlite'
      })
      expect(presentMigrationDiagnosticFailureMock.mock.calls[0]?.[1]).toEqual({
        userDataPath: '/mock/userData'
      })
      expect(getLocaleMock).toHaveBeenCalledTimes(1)
      expect(whenReadyMock.mock.invocationCallOrder[0]).toBeLessThan(getLocaleMock.mock.invocationCallOrder[0])
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
      expectNativeDiagnosticFailure('migration_status_probe_failed', 'Could not check the migration status.')
      expect(initializeMock).toHaveBeenCalledTimes(1)
      expect(registerMigratorsMock).toHaveBeenCalledTimes(1)
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('classifies migrator registration failures as database initialization failures', async () => {
      registerMigratorsMock.mockImplementation(() => {
        throw new Error('migrator registration failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expectNativeDiagnosticFailure('database_initialize_failed', 'Could not initialize the migration database.')
      expect(needsMigrationMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — schema out of sync (dev)', () => {
    it('shows the dev reset dialog with the DB path and quits when running in dev', async () => {
      initializeMock.mockImplementation(() => {
        throw schemaOutOfSyncError()
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubPlatform(true)

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      const failure = expectNativeDiagnosticFailure(
        'database_initialize_failed',
        'Could not initialize the migration database.'
      )
      expect(failure.title).toContain('Database Schema Out of Sync')
      expect(failure.message).toContain('/mock/userData/cherrystudio.sqlite')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('falls back to the neutral production dialog when the schema is out of sync but not in dev', async () => {
      initializeMock.mockImplementation(() => {
        throw schemaOutOfSyncError()
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubPlatform(false)

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      const failure = expectNativeDiagnosticFailure(
        'database_initialize_failed',
        'Could not initialize the migration database.'
      )
      expect(failure.title).toContain('Migration Failed')
      // Production must NOT get the dev variant nor any "delete the DB" instruction.
      expect(failure.title).not.toContain('(Dev)')
      expect(failure.message).not.toContain('rm -f')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('shows the dev migration-failed dialog (both causes + DB path) for non-schema errors in dev', async () => {
      initializeMock.mockImplementation(() => {
        throw new Error('DB unavailable')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubPlatform(true)

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      const failure = expectNativeDiagnosticFailure(
        'database_initialize_failed',
        'Could not initialize the migration database.'
      )
      expect(failure.title).toContain('Migration Failed (Dev)')
      expect(failure.message).toContain('DB unavailable')
      // Dev surfaces BOTH possibilities (incompatible data vs migration bug) + the DB path,
      // and explicitly does NOT assert "just delete the DB".
      expect(failure.message).toContain('/mock/userData/cherrystudio.sqlite')
      expect(failure.message).toContain('Do NOT just delete the DB')
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
      const windowError = new Error('window create failed')
      windowError.stack = 'Error: window create failed\n    at create (/app/main.js:72:3)'
      migrationWindowCreateMock.mockImplementation(() => {
        throw windowError
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      const failure = expectNativeDiagnosticFailure('migration_window_failed', 'Could not open the migration window.')
      expect(failure.title).toContain('Migration Required')
      expect(failure.message).toContain('window create failed')
      expect(failure).toMatchObject({ type: 'error', buttons: ['Quit'], defaultId: 0, cancelId: 0 })
      expect(presentMigrationDiagnosticFailureMock.mock.calls[0]?.[0].context.failure.error).toEqual({
        name: 'Error',
        message: 'window create failed',
        stack: 'Error: window create failed\n    at create (/app/main.js:72:3)'
      })
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
      expectNativeDiagnosticFailure('migration_window_failed', 'Could not open the migration window.')
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
      expect(setVersionIncompatibleMock).toHaveBeenCalledWith(
        'v1_too_old',
        {
          previousVersion: '1.5.0',
          requiredVersion: '1.9.0'
        },
        {
          currentVersion: '2.0.0',
          previousVersion: '1.5.0',
          versionLogExists: true,
          versionLogPath: '/mock/version.log'
        }
      )
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowCreateMock).toHaveBeenCalledTimes(1)
      expect(migrationWindowWaitForReadyMock).toHaveBeenCalledTimes(1)
      // Engine stays open for potential skipMigration action
      expect(closeMock).not.toHaveBeenCalled()
      // No dialog or quit — the window handles user interaction
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(presentMigrationDiagnosticFailureMock).not.toHaveBeenCalled()
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
      getBlockMessageMock.mockReturnValue('Cannot determine your previous version.')
      migrationWindowCreateMock.mockImplementation(() => {
        throw new Error('window failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      // Fallback: dialog + quit + engine close
      const failure = expectNativeDiagnosticFailure(
        'version_window_failed',
        'Could not open the upgrade guidance window.'
      )
      expect(failure).toMatchObject({
        type: 'error',
        title: 'Version Upgrade Required',
        message: 'Cannot determine your previous version.',
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0
      })
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
    })

    it('uses the version-window failure code when the version guidance window never becomes ready', async () => {
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
      getBlockMessageMock.mockReturnValue('Cannot determine your previous version.')
      migrationWindowWaitForReadyMock.mockRejectedValue(new Error('waitForReady rejected'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expectNativeDiagnosticFailure('version_window_failed', 'Could not open the upgrade guidance window.')
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(appQuitMock).toHaveBeenCalledTimes(1)
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
      expect(presentMigrationDiagnosticFailureMock).not.toHaveBeenCalled()
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
      presentMigrationDiagnosticFailureMock.mockResolvedValue(0)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      // Regression: the old dialog only had Retry/Quit, dead-ending abandoned dirs.
      const failure = expectNativeDiagnosticFailure(
        'legacy_data_location_unavailable',
        'The previous custom data directory is not currently accessible.'
      )
      expect(failure).toMatchObject({
        type: 'warning',
        title: 'Custom Data Directory Inaccessible',
        buttons: ['Retry', 'Use Default Directory', 'Quit'],
        defaultId: 0,
        cancelId: 2
      })
      expect(failure.message).toContain('/unmounted/custom')
      expect(appRelaunchMock).toHaveBeenCalledTimes(1)
      expect(pinUserDataPathMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('quits when the user chooses Quit (response 2)', async () => {
      stubInaccessible()
      presentMigrationDiagnosticFailureMock.mockResolvedValue(2)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expectNativeDiagnosticFailure(
        'legacy_data_location_unavailable',
        'The previous custom data directory is not currently accessible.'
      )
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(pinUserDataPathMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('falls back to Quit when the diagnostic presentation rejects', async () => {
      stubInaccessible()
      presentMigrationDiagnosticFailureMock.mockRejectedValue(new Error('native diagnostics unavailable'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(appRelaunchMock).not.toHaveBeenCalled()
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('pins the default dir and falls through to the normal flow on Use Default (response 1)', async () => {
      stubInaccessible()
      presentMigrationDiagnosticFailureMock.mockResolvedValue(1)
      needsMigrationMock.mockResolvedValue(false) // empty default → nothing to migrate
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      // No early return: pin the default, fall through, initialize on default,
      // and reach the normal skipped path.
      expect(pinUserDataPathMock).toHaveBeenCalledWith('/mock/userData')
      expectNativeDiagnosticFailure(
        'legacy_data_location_unavailable',
        'The previous custom data directory is not currently accessible.'
      )
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths, false)
      expect(appRelaunchMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
      expect(result).toBe('skipped')
    })

    it('quits with a fatal error when pinning the default dir fails on Use Default (response 1)', async () => {
      stubInaccessible()
      presentMigrationDiagnosticFailureMock.mockResolvedValue(1)
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
      expect(presentMigrationDiagnosticFailureMock).toHaveBeenCalledTimes(2)
      expect(presentMigrationDiagnosticFailureMock.mock.calls[1]?.[0]).toMatchObject({
        locale: 'en-US',
        context: {
          source: 'native',
          stage: 'preboot',
          errorSummary: 'Could not save the application data directory.',
          failure: { code: 'data_location_pin_failed', origin: 'main' }
        },
        failure: {
          type: 'error',
          title: 'Data Location Error - Application Cannot Start',
          buttons: ['Quit'],
          defaultId: 0,
          cancelId: 0
        }
      })
      expect(presentMigrationDiagnosticFailureMock.mock.calls[1]?.[0].context).not.toHaveProperty('failureCode')
      expect(presentMigrationDiagnosticFailureMock.mock.calls[1]?.[0].context).not.toHaveProperty('error')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(initializeMock).not.toHaveBeenCalled()
    })
  })

  describe('userData pin persistence failure', () => {
    it('quits with a fatal error when resolveMigrationPaths cannot persist the pin', async () => {
      // The only throwing operation in resolveMigrationPaths() is the strict
      // pinUserDataPath() persist on the redirect branch.
      const pinError = Object.assign(new Error('ENOSPC: no space left on device'), {
        stack: 'Error: ENOSPC: no space left on device\n    at persist (/app/main.js:8:9)',
        code: 'ENOSPC',
        syscall: 'write',
        path: '/mock/.cherrystudio/boot-config.json'
      })
      resolveMigrationPathsMock.mockImplementation(() => {
        throw pinError
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      const failure = expectNativeDiagnosticFailure(
        'data_location_pin_failed',
        'Could not save the application data directory.'
      )
      expect(failure).toMatchObject({
        type: 'error',
        title: 'Data Location Error - Application Cannot Start',
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0
      })
      expect(failure.message).toContain('ENOSPC: no space left on device')
      expect(presentMigrationDiagnosticFailureMock.mock.calls[0]?.[0].context.failure.error).toEqual({
        name: 'Error',
        message: 'ENOSPC: no space left on device',
        stack: 'Error: ENOSPC: no space left on device\n    at persist (/app/main.js:8:9)',
        code: 'ENOSPC',
        syscall: 'write',
        path: '/mock/.cherrystudio/boot-config.json'
      })
      expect(presentMigrationDiagnosticFailureMock.mock.calls[0]?.[1]).toEqual({})
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(initializeMock).not.toHaveBeenCalled()
    })

    it('still quits when the diagnostic presentation rejects', async () => {
      resolveMigrationPathsMock.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })
      presentMigrationDiagnosticFailureMock.mockRejectedValue(new Error('native diagnostics unavailable'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
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
})
