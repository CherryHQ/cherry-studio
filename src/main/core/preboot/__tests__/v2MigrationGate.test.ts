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
const appQuitMock = vi.fn()
const whenReadyMock = vi.fn().mockResolvedValue(undefined)
const relaunchMock = vi.fn()
const exitMock = vi.fn()

const setVersionIncompatibleMock = vi.fn()
const existsSyncMock = vi.fn()
const checkUpgradePathMock = vi.fn()
const readPreviousVersionMock = vi.fn()
const getBlockMessageMock = vi.fn()

const defaultMigrationPaths = { userData: '/mock/userData', versionLogFile: '/mock/version.log' }
const defaultResolveResult = { paths: defaultMigrationPaths, userDataChanged: false, inaccessibleLegacyPath: null }

function stubMigrationV2() {
  vi.doMock('@data/migration/v2', () => ({
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
    setVersionIncompatible: setVersionIncompatibleMock
  }))
}

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      whenReady: whenReadyMock,
      relaunch: relaunchMock,
      exit: exitMock,
      getVersion: vi.fn().mockReturnValue('2.0.0')
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
      quit: appQuitMock
    }
  }))
}

function stubVersionPolicy() {
  vi.doMock('@data/migration/v2/core/versionPolicy', () => ({
    checkUpgradePathCompatibility: checkUpgradePathMock,
    readPreviousVersion: readPreviousVersionMock,
    getBlockMessage: getBlockMessageMock
  }))
}

function stubFs() {
  vi.doMock('node:fs', () => ({
    __esModule: true,
    default: { existsSync: existsSyncMock }
  }))
}

async function loadModule() {
  return import('../v2MigrationGate')
}

beforeEach(() => {
  vi.resetModules()
  resolveMigrationPathsMock.mockReset().mockReturnValue(defaultResolveResult)
  initializeMock.mockReset().mockResolvedValue(undefined)
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
  appQuitMock.mockReset()
  whenReadyMock.mockReset().mockResolvedValue(undefined)
  relaunchMock.mockReset()
  exitMock.mockReset()
  setVersionIncompatibleMock.mockReset()
  existsSyncMock.mockReset()
  checkUpgradePathMock.mockReset()
  readPreviousVersionMock.mockReset()
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
      expect(initializeMock).toHaveBeenCalledWith(defaultMigrationPaths)
      expect(registerMigratorsMock).toHaveBeenCalledTimes(1)
      expect(registerMigratorsMock).toHaveBeenCalledWith(migrators)
    })
  })

  describe('handled path — migration runs', () => {
    it("returns 'handled' and leaves IPC handlers registered when the migration window starts", async () => {
      needsMigrationMock.mockResolvedValue(true)
      existsSyncMock.mockReturnValue(true)
      readPreviousVersionMock.mockReturnValue('1.9.0')
      checkUpgradePathMock.mockReturnValue({ outcome: 'pass' })
      migrationWindowCreateMock.mockImplementation(() => {
        /* no-op — success */
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

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
    it("returns 'handled', shows an error dialog, and quits when the engine fails to initialize", async () => {
      initializeMock.mockRejectedValue(new Error('DB unavailable'))
      stubMigrationV2()
      stubElectron()
      stubApplication()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(whenReadyMock).toHaveBeenCalledTimes(1)
      expect(showErrorBoxMock).toHaveBeenCalledTimes(1)
      const [title, message] = showErrorBoxMock.mock.calls[0]
      expect(title).toContain('Migration Status Check Failed')
      expect(message).toContain('DB unavailable')
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
      expect(showErrorBoxMock).toHaveBeenCalledTimes(1)
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — migration window start fails', () => {
    it("returns 'handled', unregisters IPC handlers, and quits when migrationWindowManager.create() throws", async () => {
      needsMigrationMock.mockResolvedValue(true)
      existsSyncMock.mockReturnValue(true)
      readPreviousVersionMock.mockReturnValue('1.9.0')
      checkUpgradePathMock.mockReturnValue({ outcome: 'pass' })
      migrationWindowCreateMock.mockImplementation(() => {
        throw new Error('window create failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(registerMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(showErrorBoxMock).toHaveBeenCalledTimes(1)
      const [title, message] = showErrorBoxMock.mock.calls[0]
      expect(title).toContain('Migration Required')
      expect(message).toContain('window create failed')
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })

    it("returns 'handled' when waitForReady() rejects after window create succeeds", async () => {
      needsMigrationMock.mockResolvedValue(true)
      existsSyncMock.mockReturnValue(true)
      readPreviousVersionMock.mockReturnValue('1.9.0')
      checkUpgradePathMock.mockReturnValue({ outcome: 'pass' })
      migrationWindowWaitForReadyMock.mockRejectedValue(new Error('waitForReady rejected'))
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
      expect(showErrorBoxMock).toHaveBeenCalledTimes(1)
      expect(appQuitMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('handled path — version compatibility check fails', () => {
    it("returns 'handled' and shows version_incompatible window when version check blocks", async () => {
      needsMigrationMock.mockResolvedValue(true)
      existsSyncMock.mockReturnValue(true)
      readPreviousVersionMock.mockReturnValue('1.5.0')
      checkUpgradePathMock.mockReturnValue({
        outcome: 'block',
        reason: 'v1_too_old',
        details: { previousVersion: '1.5.0', requiredVersion: '1.9.0' }
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

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
      existsSyncMock.mockReturnValue(false)
      checkUpgradePathMock.mockReturnValue({
        outcome: 'block',
        reason: 'no_version_log',
        details: { requiredVersion: '1.9.0' }
      })
      getBlockMessageMock.mockReturnValue('Cannot determine your previous version.')
      migrationWindowCreateMock.mockImplementation(() => {
        throw new Error('window failed')
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

      const { runV2MigrationGate } = await loadModule()
      const result = await runV2MigrationGate()

      expect(result).toBe('handled')
      // Fallback: dialog + quit + engine close
      expect(showErrorBoxMock).toHaveBeenCalledTimes(1)
      expect(appQuitMock).toHaveBeenCalledTimes(1)
      expect(closeMock).toHaveBeenCalledTimes(1)
      expect(unregisterMigrationIpcHandlersMock).toHaveBeenCalledTimes(1)
    })

    it('proceeds to migration window when version check passes', async () => {
      needsMigrationMock.mockResolvedValue(true)
      existsSyncMock.mockReturnValue(true)
      readPreviousVersionMock.mockReturnValue('1.9.0')
      checkUpgradePathMock.mockReturnValue({ outcome: 'pass' })
      migrationWindowCreateMock.mockImplementation(() => {
        /* no-op — success */
      })
      stubMigrationV2()
      stubElectron()
      stubApplication()
      stubVersionPolicy()
      stubFs()

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
})
