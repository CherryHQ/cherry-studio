import type { MigrationDiagnosticsCoordinator } from '@data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator'
import type * as MigrationDiagnosticsModule from '@data/migration/v2/migrationDiagnostics'
import type {
  MigrationWindowFailureClaim,
  MigrationWindowManager
} from '@data/migration/v2/window/MigrationWindowManager'
import type * as PlatformModule from '@main/core/platform'
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
const getAllMigratorsMock = vi.fn((): unknown[] => [])
const migrationWindowCreateMock = vi.fn()
const migrationWindowWaitForReadyMock = vi.fn()
const registerMigrationIpcHandlersMock = vi.fn()
const unregisterMigrationIpcHandlersMock = vi.fn()
const runMigrationDiagnosticSaveTransactionMock = vi.fn()
const resolveMigrationPathsMock = vi.fn()
const showErrorBoxMock = vi.fn()
const appQuitMock = vi.fn()
const appRelaunchMock = vi.fn()
const appGetVersionMock = vi.fn().mockReturnValue('2.0.0')
const whenReadyMock = vi.fn().mockResolvedValue(undefined)

const setVersionIncompatibleMock = vi.fn()
const setDataLocationNoticeMock = vi.fn()
const pinUserDataPathMock = vi.fn()
const evaluateCandidateVersionMock = vi.fn()
const diagnosticsCoordinatorConstructedMock = vi.fn()
const diagnosticsAttachPathsMock = vi.fn()
const diagnosticsBeginAttemptMock = vi.fn()
const diagnosticsUpdateLocationMock = vi.fn()
const diagnosticsFinishAttemptMock = vi.fn()
const diagnosticsCompleteMock = vi.fn()
const diagnosticsSnapshotMock = vi.fn()
const diagnosticBundleSaveMock = vi.fn()
const databaseDiagnosticsInspectMock = vi.fn()
const presentDiagnosticFailureMock = vi.fn()
const presentDiagnosticRecoveryMock = vi.fn()
let diagnosticsRecovered = false

const diagnosticsSnapshot = {
  formatVersion: 1,
  app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
  state: 'active'
}

const diagnosticsCoordinator = {
  get recovered() {
    return diagnosticsRecovered
  },
  attachPaths: diagnosticsAttachPathsMock,
  beginAttempt: diagnosticsBeginAttemptMock,
  updateLocation: diagnosticsUpdateLocationMock,
  finishAttempt: diagnosticsFinishAttemptMock,
  complete: diagnosticsCompleteMock,
  snapshot: diagnosticsSnapshotMock
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
  diagnosticsJournalFile: '/mock/userData/migration-diagnostics-v2.json'
}
const defaultResolveResult = {
  paths: defaultMigrationPaths,
  userDataChanged: false,
  inaccessibleLegacyPath: null,
  legacyDataConfirmed: false,
  directorySelectionRole: 'default' as const,
  dataLocation: undefined
}

interface MigrationV2StubOptions {
  readonly diagnosticsCoordinator?: object
  readonly migrationWindowManager?: object
}

function stubMigrationV2(options: MigrationV2StubOptions = {}) {
  vi.doMock('@data/migration/v2', async () => {
    const migrationDiagnostics = await vi.importActual<typeof MigrationDiagnosticsModule>(
      '@data/migration/v2/migrationDiagnostics'
    )
    const { isSchemaOutOfSyncError } = await vi.importActual<{
      isSchemaOutOfSyncError(error: unknown): boolean
    }>('@data/migration/v2/core/migrationErrors')
    const { createMigrationWindowFailureClaim } = await vi.importActual<{
      createMigrationWindowFailureClaim(): MigrationWindowFailureClaim
    }>('@data/migration/v2/window/MigrationWindowManager')
    return {
      ...migrationDiagnostics,
      migrationEngine: {
        initialize: initializeMock,
        registerMigrators: registerMigratorsMock,
        needsMigration: needsMigrationMock,
        close: closeMock,
        paths: { versionLogFile: '/fake/version.log', userData: '/fake/userData' }
      },
      getAllMigrators: getAllMigratorsMock,
      migrationWindowManager: options.migrationWindowManager ?? {
        create: migrationWindowCreateMock,
        waitForReady: migrationWindowWaitForReadyMock
      },
      registerMigrationIpcHandlers: registerMigrationIpcHandlersMock,
      unregisterMigrationIpcHandlers: unregisterMigrationIpcHandlersMock,
      runMigrationDiagnosticSaveTransaction: runMigrationDiagnosticSaveTransactionMock,
      resolveMigrationPaths: resolveMigrationPathsMock,
      pinUserDataPath: pinUserDataPathMock,
      setVersionIncompatible: setVersionIncompatibleMock,
      setDataLocationNotice: setDataLocationNoticeMock,
      evaluateCandidateVersion: evaluateCandidateVersionMock,
      isSchemaOutOfSyncError,
      createMigrationWindowFailureClaim,
      createMigrationDiagnosticsCoordinator: () =>
        options.diagnosticsCoordinator ?? new MigrationDiagnosticsCoordinatorMock(),
      createMigrationDiagnosticBundleBuilder: () => new MigrationDiagnosticBundleBuilderMock(),
      createMigrationDatabaseDiagnostics: () => new MigrationDatabaseDiagnosticsMock(),
      presentMigrationDiagnosticFailure: presentDiagnosticFailureMock,
      presentMigrationDiagnosticRecovery: presentDiagnosticRecoveryMock
    }
  })
}

function stubElectron(browserWindowFactory?: () => object) {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      whenReady: whenReadyMock,
      getVersion: appGetVersionMock,
      getLocale: vi.fn().mockReturnValue('en-US')
    },
    BrowserWindow: vi.fn(browserWindowFactory),
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

function stubPlatform(isDev: boolean) {
  vi.doMock('@main/core/platform', async () => ({
    ...(await vi.importActual<typeof PlatformModule>('@main/core/platform')),
    isDev
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

async function createMemoryDiagnosticsCoordinator(): Promise<MigrationDiagnosticsCoordinator> {
  const { MigrationDiagnosticsCoordinator: Coordinator } = await vi.importActual<{
    MigrationDiagnosticsCoordinator: typeof MigrationDiagnosticsCoordinator
  }>('@data/migration/v2/diagnostics/MigrationDiagnosticsCoordinator')
  const coordinator = new Coordinator({
    appVersion: '2.0.0',
    platform: 'darwin',
    arch: 'arm64',
    clock: () => new Date('2026-07-19T10:00:00.000Z')
  })
  vi.spyOn(coordinator, 'attachPaths').mockImplementation(() => undefined)
  return coordinator
}

async function createRealMigrationWindowManager(): Promise<MigrationWindowManager> {
  const { MigrationWindowManager: Manager } = await vi.importActual<{
    MigrationWindowManager: typeof MigrationWindowManager
  }>('@data/migration/v2/window/MigrationWindowManager')
  return new Manager()
}

function makeGateWindow(load: () => Promise<void>) {
  const webContentsHandlers: Record<string, (...args: unknown[]) => void> = {}
  return {
    show: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn(load),
    once: vi.fn(),
    on: vi.fn(),
    webContents: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        webContentsHandlers[event] = handler
      }),
      once: vi.fn(),
      send: vi.fn(),
      isLoading: vi.fn(() => false),
      emit: (event: string, ...args: unknown[]) => webContentsHandlers[event]?.(...args)
    }
  }
}

type RendererFailureCallback = (
  reason: 'renderer_process_gone' | 'renderer_unresponsive',
  writesSettled: Promise<void>
) => Promise<void>

interface RegisteredMigrationDiagnosticsCapabilities {
  start(): Promise<void>
  reportRendererExportFailure(
    report: { sourceRole: 'redux'; operationRole: 'parse' } | { sourceRole: 'local_storage'; operationRole: 'write' },
    mainWriteFailure?: {
      errorCode: 'file_invalid_type'
      filesystemEvidence: {
        causeCode: 'ENOTDIR'
        filesystemOperation: 'mkdir'
        targetRole: 'local_storage_export_file'
        blockingNodeRole: 'migration_temp_root'
        expectedNodeType: 'file'
        observedNodeType: 'file'
      }
    }
  ): Promise<void>
  saveDiagnosticBundle(destination: string): Promise<unknown>
  completeVersionGate(): void
}

function registeredDiagnosticsCapabilities(): RegisteredMigrationDiagnosticsCapabilities {
  const capabilities = registerMigrationIpcHandlersMock.mock.calls.at(-1)?.[1]
  if (!capabilities) throw new Error('Migration diagnostics capabilities were not registered')
  return capabilities as RegisteredMigrationDiagnosticsCapabilities
}

beforeEach(() => {
  vi.resetModules()
  stubPlatform(false)
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
  runMigrationDiagnosticSaveTransactionMock.mockReset().mockImplementation((operation) => operation())
  showErrorBoxMock.mockReset()
  appQuitMock.mockReset()
  appRelaunchMock.mockReset()
  appGetVersionMock.mockReset().mockReturnValue('2.0.0')
  whenReadyMock.mockReset().mockResolvedValue(undefined)
  setVersionIncompatibleMock.mockReset()
  setDataLocationNoticeMock.mockReset()
  pinUserDataPathMock.mockReset()
  evaluateCandidateVersionMock.mockReset()
  diagnosticsCoordinatorConstructedMock.mockReset()
  diagnosticsAttachPathsMock.mockReset()
  diagnosticsBeginAttemptMock.mockReset().mockReturnValue('attempt-id')
  diagnosticsUpdateLocationMock.mockReset()
  diagnosticsFinishAttemptMock.mockReset()
  diagnosticsCompleteMock.mockReset()
  diagnosticsSnapshotMock.mockReset().mockResolvedValue(diagnosticsSnapshot)
  diagnosticBundleSaveMock.mockReset().mockResolvedValue({ status: 'saved', uncompressedBytes: 1 })
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
      expect(initializeMock).toHaveBeenCalledWith(
        defaultMigrationPaths,
        false,
        expect.objectContaining({
          updateLocation: expect.any(Function),
          finishAttempt: expect.any(Function),
          complete: expect.any(Function)
        })
      )
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
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledWith(
        '/mock/userData',
        expect.objectContaining({
          reportRendererExportFailure: expect.any(Function),
          saveDiagnosticBundle: expect.any(Function),
          start: expect.any(Function)
        })
      )
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

    it('single-flights concurrent renderer starts and still terminates their manual retry on export failure', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const capabilities = registeredDiagnosticsCapabilities()
      coordinator.finishAttempt({
        status: 'failed',
        failure: {
          kind: 'migration_finalize_failed',
          scope: 'engine',
          phase: 'finalize',
          errorCode: 'sqlite_constraint'
        }
      })

      await Promise.all([capabilities.start(), capabilities.start()])
      await capabilities.reportRendererExportFailure({ sourceRole: 'redux', operationRole: 'parse' })

      const snapshot = await coordinator.snapshot()
      expect(snapshot.previous).toMatchObject({ trigger: 'initial', status: 'failed' })
      expect(snapshot.current).toMatchObject({
        trigger: 'manual_retry',
        status: 'failed',
        lastLocation: { scope: 'renderer_export', phase: 'prepare' },
        failure: {
          kind: 'renderer_export_failed',
          errorCode: 'source_parse_failed',
          evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
        }
      })
      expect(JSON.stringify(snapshot)).not.toContain('canary-secret')
      expect(JSON.stringify(snapshot)).not.toContain('/Users/private')
    })

    it('ends renderer export failure with allowlisted diagnostics and never records the raw renderer message', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const capabilities = registeredDiagnosticsCapabilities()

      await capabilities.start()
      await capabilities.reportRendererExportFailure({ sourceRole: 'redux', operationRole: 'parse' })

      const snapshot = await coordinator.snapshot()
      expect(snapshot.current).toMatchObject({
        status: 'failed',
        lastLocation: { scope: 'renderer_export', phase: 'prepare' },
        failure: {
          kind: 'renderer_export_failed',
          scope: 'renderer_export',
          phase: 'finalize',
          errorCode: 'source_parse_failed',
          evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
        }
      })
      expect(JSON.stringify(snapshot)).not.toContain('canary-secret')
      expect(JSON.stringify(snapshot)).not.toContain('/Users/private')
    })

    it('uses Main-owned target metadata instead of an untrusted renderer report for filesystem evidence', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.0',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const capabilities = registeredDiagnosticsCapabilities()

      await capabilities.start()
      await capabilities.reportRendererExportFailure(
        { sourceRole: 'redux', operationRole: 'parse' },
        {
          errorCode: 'file_invalid_type',
          filesystemEvidence: {
            causeCode: 'ENOTDIR',
            filesystemOperation: 'mkdir',
            targetRole: 'local_storage_export_file',
            blockingNodeRole: 'migration_temp_root',
            expectedNodeType: 'file',
            observedNodeType: 'file'
          }
        }
      )

      const snapshot = await coordinator.snapshot()
      expect(snapshot.current).toMatchObject({
        status: 'failed',
        failure: {
          kind: 'renderer_export_failed',
          errorCode: 'file_invalid_type',
          evidence: {
            kind: 'renderer_export',
            sourceRole: 'local_storage',
            operationRole: 'write',
            filesystemEvidence: {
              causeCode: 'ENOTDIR',
              filesystemOperation: 'mkdir',
              targetRole: 'local_storage_export_file',
              blockingNodeRole: 'migration_temp_root',
              expectedNodeType: 'file',
              observedNodeType: 'file'
            }
          }
        }
      })
      expect(JSON.stringify(snapshot)).not.toContain('/mock/userData')
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_')
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
    it('shows actionable schema reset guidance in the save-capable native presenter during development', async () => {
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
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'database_initialize_failed',
          detail: expect.stringContaining('/mock/userData/cherrystudio.sqlite'),
          saveBundle: expect.any(Function)
        })
      )
      expect(presentDiagnosticFailureMock.mock.calls[0]?.[0].detail).toContain('rm -f')
      expect(presentDiagnosticFailureMock.mock.calls[0]?.[0].detail).toContain('table `agent` already exists')
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it('shows both likely causes and the database path in the save-capable development presenter', async () => {
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
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'database_initialize_failed',
          detail: expect.stringContaining('DB unavailable'),
          saveBundle: expect.any(Function)
        })
      )
      expect(presentDiagnosticFailureMock.mock.calls[0]?.[0].detail).toContain('/mock/userData/cherrystudio.sqlite')
      expect(presentDiagnosticFailureMock.mock.calls[0]?.[0].detail).toContain('Do NOT just delete the DB')
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
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(2)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'migration_window_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — version compatibility check fails', () => {
    it.each([
      {
        currentVersion: '2.0.0-beta.1',
        evaluation: {
          check: {
            outcome: 'block' as const,
            reason: 'no_version_log' as const,
            details: { requiredVersion: '1.9.12' }
          },
          previousVersion: null,
          versionLogExists: false,
          versionLog: { state: 'missing' as const }
        },
        expected: {
          reason: 'no_version_log',
          currentVersion: '2.0.0-beta.1',
          directorySelectionRole: 'default',
          previousVersion: null,
          requiredVersion: '1.9.12',
          gatewayVersion: null,
          versionLog: { state: 'missing' }
        }
      },
      {
        currentVersion: '2.0.0',
        evaluation: {
          check: {
            outcome: 'block' as const,
            reason: 'v1_too_old' as const,
            details: { previousVersion: '1.8.0', requiredVersion: '1.9.12' }
          },
          previousVersion: '1.8.0',
          versionLogExists: true,
          versionLog: {
            state: 'parsed' as const,
            validRecordCountBucket: '1' as const,
            invalidRecordCountBucket: '0' as const
          }
        },
        expected: {
          reason: 'v1_too_old',
          currentVersion: '2.0.0',
          directorySelectionRole: 'default',
          previousVersion: '1.8.0',
          requiredVersion: '1.9.12',
          gatewayVersion: null,
          versionLog: {
            state: 'parsed',
            validRecordCountBucket: '1',
            invalidRecordCountBucket: '0'
          }
        }
      },
      {
        currentVersion: '2.1.0+private',
        evaluation: {
          check: {
            outcome: 'block' as const,
            reason: 'v2_gateway_skipped' as const,
            details: { previousVersion: '1.9.12', currentVersion: '2.1.0+private', gatewayVersion: '2.0.0' }
          },
          previousVersion: '1.9.12',
          versionLogExists: true,
          versionLog: {
            state: 'parsed' as const,
            validRecordCountBucket: '1' as const,
            invalidRecordCountBucket: '0' as const
          }
        },
        expected: {
          reason: 'v2_gateway_skipped',
          currentVersion: '2.1.0',
          directorySelectionRole: 'default',
          previousVersion: '1.9.12',
          requiredVersion: null,
          gatewayVersion: '2.0.0',
          versionLog: {
            state: 'parsed',
            validRecordCountBucket: '1',
            invalidRecordCountBucket: '0'
          }
        }
      }
    ])('records a sanitized $expected.reason root only after version guidance is ready', async (testCase) => {
      appGetVersionMock.mockReturnValue(testCase.currentVersion)
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue(testCase.evaluation)
      const coordinator = await createMemoryDiagnosticsCoordinator()
      const finishAttempt = vi.spyOn(coordinator, 'finishAttempt')
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(finishAttempt).toHaveBeenCalledWith({
        status: 'failed',
        failure: {
          kind: 'upgrade_path_blocked',
          scope: 'gate',
          phase: 'validate',
          errorCode: testCase.expected.reason,
          evidence: { kind: 'version_gate', context: testCase.expected }
        }
      })
      expect(migrationWindowWaitForReadyMock.mock.invocationCallOrder[0]).toBeLessThan(
        finishAttempt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
      expect(JSON.stringify(await coordinator.snapshot())).not.toContain('+private')
    })

    it("returns 'handled' and shows version_incompatible window when version check blocks", async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: {
          outcome: 'block',
          reason: 'v1_too_old',
          details: { previousVersion: '1.5.0', requiredVersion: '1.9.0' }
        },
        previousVersion: '1.5.0',
        versionLogExists: true,
        versionLog: { state: 'parsed', validRecordCountBucket: '1', invalidRecordCountBucket: '0' }
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

    it('cleans the recorded version-gate diagnostic only when the guidance window closes normally', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: {
          outcome: 'block',
          reason: 'v1_too_old',
          details: { previousVersion: '1.5.0', requiredVersion: '1.9.0' }
        },
        previousVersion: '1.5.0',
        versionLogExists: true,
        versionLog: { state: 'parsed', validRecordCountBucket: '1', invalidRecordCountBucket: '0' }
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(diagnosticsFinishAttemptMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsCompleteMock).not.toHaveBeenCalled()

      const capabilities = registeredDiagnosticsCapabilities()
      expect(capabilities.completeVersionGate).toBeTypeOf('function')
      capabilities.completeVersionGate()
      capabilities.completeVersionGate()

      expect(diagnosticsCompleteMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsFinishAttemptMock.mock.invocationCallOrder[0]).toBeLessThan(
        diagnosticsCompleteMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
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
      expect(initializeMock).toHaveBeenCalledWith(
        defaultMigrationPaths,
        false,
        expect.objectContaining({
          updateLocation: expect.any(Function),
          finishAttempt: expect.any(Function),
          complete: expect.any(Function)
        })
      )
      expect(appRelaunchMock).not.toHaveBeenCalled()
      expect(appQuitMock).not.toHaveBeenCalled()
      expect(result).toBe('skipped')
      expect(diagnosticsFinishAttemptMock).toHaveBeenNthCalledWith(1, {
        status: 'failed',
        failure: {
          kind: 'preboot_failed',
          scope: 'gate',
          phase: 'resolve_paths',
          errorCode: 'legacy_data_location_unavailable'
        }
      })
      expect(diagnosticsBeginAttemptMock).toHaveBeenNthCalledWith(2, 'manual_retry')
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
        throw Object.assign(new Error('EACCES: permission denied, open /Users/private/config.json'), {
          code: 'EACCES'
        })
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
      expect(diagnosticsFinishAttemptMock).toHaveBeenCalledWith({
        status: 'failed',
        failure: {
          kind: 'preboot_failed',
          scope: 'gate',
          phase: 'resolve_paths',
          errorCode: 'path_resolution_failed'
        }
      })
      expect(JSON.stringify(diagnosticsFinishAttemptMock.mock.calls)).not.toContain('/Users/private')
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
      expect(initializeMock).toHaveBeenCalledWith(
        defaultMigrationPaths,
        false,
        expect.objectContaining({
          updateLocation: expect.any(Function),
          finishAttempt: expect.any(Function),
          complete: expect.any(Function)
        })
      )
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
      expect(diagnosticsFinishAttemptMock).toHaveBeenCalledWith({ status: 'completed' })
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
            file: { status: 'unreadable', sqliteHeader: 'unavailable' },
            sqlite: { status: 'unavailable', reason: 'not_attempted' }
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

    it('continues migration when checkpoint attachment fails', async () => {
      diagnosticsAttachPathsMock.mockImplementation(() => {
        throw new Error('journal')
      })
      needsMigrationMock.mockResolvedValue(false)
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await expect(runV2MigrationGate()).resolves.toBe('skipped')

      expect(presentDiagnosticFailureMock).not.toHaveBeenCalled()
      expect(initializeMock).toHaveBeenCalledTimes(1)
    })

    it('routes a version-policy read failure through the typed presenter', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockImplementation(() => {
        throw new Error('version')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'version_check_failed' })
      )
    })

    it('restores version guidance when its real window load rejects', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'block', reason: 'no_version_log', details: { requiredVersion: '1.9.12' } },
        previousVersion: null,
        versionLogExists: false,
        versionLog: { state: 'missing' }
      })
      const nativeWindow = makeGateWindow(() => Promise.reject(new Error('PRIVATE_LOAD_FAILURE_/Users/alice')))
      stubElectron(() => nativeWindow)
      const windowManager = await createRealMigrationWindowManager()
      const coordinator = await createMemoryDiagnosticsCoordinator()
      stubMigrationV2({ diagnosticsCoordinator: coordinator, migrationWindowManager: windowManager })
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(nativeWindow.loadFile).toHaveBeenCalledTimes(1)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'version_window_failed' })
      )
      expect(showErrorBoxMock).not.toHaveBeenCalled()
      expect(JSON.stringify(presentDiagnosticFailureMock.mock.calls)).not.toContain('PRIVATE_LOAD_FAILURE')
      expect((await coordinator.snapshot()).current).toMatchObject({
        status: 'failed',
        failure: {
          kind: 'preboot_failed',
          errorCode: 'version_window_failed',
          evidence: {
            kind: 'version_gate',
            context: { reason: 'no_version_log', versionLog: { state: 'missing' } }
          }
        }
      })
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    describe.each([
      {
        route: 'migration',
        loadFailureCode: 'migration_window_failed',
        decision: 'retry',
        configure: () => {
          needsMigrationMock.mockResolvedValue(true)
          evaluateCandidateVersionMock.mockReturnValue({
            check: { outcome: 'pass' },
            previousVersion: '1.9.12',
            versionLogExists: true
          })
        }
      }
    ] as const)('$route native load/renderer failure race', ({ loadFailureCode, decision, configure }) => {
      it.each(['renderer-first', 'load-first'] as const)(
        'claims one native failure operation when signals arrive %s',
        async (order) => {
          configure()
          const coordinator = await createMemoryDiagnosticsCoordinator()
          const finishAttempt = vi.spyOn(coordinator, 'finishAttempt')
          let rejectLoad!: (error: Error) => void
          const loadPromise = new Promise<void>((_resolve, reject) => {
            rejectLoad = reject
          })
          const nativeWindow = makeGateWindow(() => loadPromise)
          stubElectron(() => nativeWindow)
          const windowManager = await createRealMigrationWindowManager()
          stubMigrationV2({ diagnosticsCoordinator: coordinator, migrationWindowManager: windowManager })
          stubApplication()

          let resolveDecision!: (decision: 'exit' | 'retry') => void
          const decisionPending = new Promise<'exit' | 'retry'>((resolve) => {
            resolveDecision = resolve
          })
          let bundleSaved = false
          presentDiagnosticFailureMock.mockImplementation(
            async (state: { saveBundle: (path: string) => Promise<unknown> }) => {
              if (!bundleSaved) {
                bundleSaved = true
                await state.saveBundle('/safe/migration-diagnostics.zip')
              }
              return decisionPending
            }
          )

          const { runV2MigrationGate } = await loadModule()
          const gateResult = runV2MigrationGate()
          await vi.waitFor(() => expect(nativeWindow.loadFile).toHaveBeenCalledTimes(1))

          const loadError = new Error('PRIVATE_LOAD_FAILURE_/Users/alice/api-key=sk-private')
          const rendererDetails = {
            reason: 'crashed',
            details: 'PRIVATE_ELECTRON_DETAILS_/Users/alice/model-key=secret'
          }
          if (order === 'renderer-first') {
            nativeWindow.webContents.emit('render-process-gone', {}, rendererDetails)
            rejectLoad(loadError)
          } else {
            rejectLoad(loadError)
            await vi.waitFor(() => expect(presentDiagnosticFailureMock).toHaveBeenCalledTimes(1))
            nativeWindow.webContents.emit('render-process-gone', {}, rendererDetails)
          }

          await vi.waitFor(() => expect(diagnosticBundleSaveMock).toHaveBeenCalledTimes(1))
          await new Promise<void>((resolve) => setImmediate(resolve))
          const presenterCallsBeforeDecision = presentDiagnosticFailureMock.mock.calls.length
          resolveDecision(decision)
          const result = await gateResult
          await new Promise<void>((resolve) => setImmediate(resolve))

          const expectedFailureCode = order === 'renderer-first' ? 'renderer_process_gone' : loadFailureCode
          const snapshot = await coordinator.snapshot()
          const bundleInput = diagnosticBundleSaveMock.mock.calls[0]?.[0] as { snapshot: unknown }

          expect(result).toBe('handled')
          expect(presenterCallsBeforeDecision).toBe(1)
          expect(presentDiagnosticFailureMock).toHaveBeenCalledTimes(1)
          expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
            expect.objectContaining({ code: expectedFailureCode })
          )
          expect(finishAttempt).toHaveBeenCalledTimes(1)
          expect(snapshot.current).toMatchObject(
            order === 'renderer-first'
              ? {
                  status: 'interrupted',
                  failure: {
                    kind: 'process_interrupted',
                    errorCode: 'renderer_process_gone',
                    evidence: { kind: 'interruption', recoverySource: 'live_renderer_event' }
                  }
                }
              : {
                  status: 'failed',
                  failure: { kind: 'preboot_failed', errorCode: 'migration_window_failed' }
                }
          )
          expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(2)
          expect(closeMock).toHaveBeenCalledTimes(1)
          expect(appQuitMock).not.toHaveBeenCalled()
          expect(appRelaunchMock).toHaveBeenCalledTimes(1)
          expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_LOAD_FAILURE')
          expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_ELECTRON_DETAILS')
          expect(JSON.stringify(bundleInput.snapshot)).not.toContain('PRIVATE_LOAD_FAILURE')
          expect(JSON.stringify(bundleInput.snapshot)).not.toContain('PRIVATE_ELECTRON_DETAILS')
        }
      )
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

    it('keeps quit deferral installed while a native renderer-failure dialog can save diagnostics', async () => {
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      const order: string[] = []
      unregisterMigrationIpcHandlersMock.mockImplementation(
        (options?: { readonly preserveWriteDeferral?: boolean }) => {
          order.push(options?.preserveWriteDeferral ? 'unregister:preserve' : 'unregister:clear')
        }
      )
      let presenterState: Record<string, unknown> | undefined
      presentDiagnosticFailureMock.mockImplementation(async (state: Record<string, unknown>) => {
        presenterState = state
        order.push('present')
        return 'exit'
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const createCall = migrationWindowCreateMock.mock.calls[0]
      expect(createCall).toBeDefined()
      const callback = (createCall[0] as { onRendererFailure: RendererFailureCallback }).onRendererFailure

      await callback('renderer_process_gone', Promise.resolve())

      expect(presenterState?.['runSaveTransaction']).toBe(runMigrationDiagnosticSaveTransactionMock)
      expect(order).toEqual(['unregister:preserve', 'present', 'unregister:clear'])
    })

    it('records one introduction crash interruption before presenting native actions', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const createCall = migrationWindowCreateMock.mock.calls[0]
      expect(createCall).toBeDefined()
      const callback = (createCall[0] as { onRendererFailure: RendererFailureCallback }).onRendererFailure

      await callback('renderer_process_gone', Promise.resolve())

      const snapshot = await coordinator.snapshot()
      expect(snapshot.current).toMatchObject({
        status: 'interrupted',
        failure: {
          kind: 'process_interrupted',
          scope: 'engine',
          phase: 'interrupted',
          errorCode: 'renderer_process_gone',
          evidence: { kind: 'interruption', recoverySource: 'live_renderer_event' }
        }
      })
      expect(presentDiagnosticFailureMock).toHaveBeenCalledTimes(1)
    })

    it('records an in-flight hang interruption before waiting and rejects a later engine terminal', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator })
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()
      const createCall = migrationWindowCreateMock.mock.calls[0]
      expect(createCall).toBeDefined()
      const callback = (createCall[0] as { onRendererFailure: RendererFailureCallback }).onRendererFailure
      let settleWrites!: () => void
      const writesSettled = new Promise<void>((resolve) => {
        settleWrites = resolve
      })

      const nativeFlow = callback('renderer_unresponsive', writesSettled)
      await new Promise<void>((resolve) => setImmediate(resolve))
      const beforeSettle = await coordinator.snapshot()
      const presenterCallsBeforeSettle = presentDiagnosticFailureMock.mock.calls.length

      expect(() =>
        coordinator.finishAttempt({
          status: 'failed',
          failure: {
            kind: 'migration_finalize_failed',
            scope: 'engine',
            phase: 'finalize',
            errorCode: 'unknown_error'
          }
        })
      ).toThrow('requires an active attempt')
      settleWrites()
      await nativeFlow

      const afterSettle = await coordinator.snapshot()
      expect(beforeSettle.current).toMatchObject({
        status: 'interrupted',
        failure: { kind: 'process_interrupted', errorCode: 'renderer_unresponsive' }
      })
      expect(presenterCallsBeforeSettle).toBe(0)
      expect(afterSettle.current).toEqual(beforeSettle.current)
      expect(presentDiagnosticFailureMock).toHaveBeenCalledTimes(1)
    })

    it('deduplicates crash-to-hang re-entry across the real manager, marker, and presenter', async () => {
      const coordinator = await createMemoryDiagnosticsCoordinator()
      const finishAttempt = vi.spyOn(coordinator, 'finishAttempt')
      const nativeWindow = makeGateWindow(() => Promise.resolve())
      stubElectron(() => nativeWindow)
      const windowManager = await createRealMigrationWindowManager()
      needsMigrationMock.mockResolvedValue(true)
      evaluateCandidateVersionMock.mockReturnValue({
        check: { outcome: 'pass' },
        previousVersion: '1.9.12',
        versionLogExists: true
      })
      stubMigrationV2({ diagnosticsCoordinator: coordinator, migrationWindowManager: windowManager })
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      await runV2MigrationGate()

      nativeWindow.webContents.emit(
        'render-process-gone',
        {},
        {
          reason: 'crashed',
          details: 'PRIVATE_ELECTRON_DETAILS_/Users/alice'
        }
      )
      await Promise.resolve()
      nativeWindow.webContents.emit('unresponsive')
      await vi.waitFor(() => expect(presentDiagnosticFailureMock).toHaveBeenCalledTimes(1))

      const snapshot = await coordinator.snapshot()
      expect(finishAttempt).toHaveBeenCalledTimes(1)
      expect(snapshot.current).toMatchObject({
        status: 'interrupted',
        failure: { kind: 'process_interrupted', errorCode: 'renderer_process_gone' }
      })
      expect(presentDiagnosticFailureMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'renderer_process_gone' })
      )
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_ELECTRON_DETAILS')
    })
  })
})
