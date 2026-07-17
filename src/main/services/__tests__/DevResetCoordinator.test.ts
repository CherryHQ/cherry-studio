import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireFenceMock,
  drainBackupMock,
  releaseFenceMock,
  assertIdleMock,
  readJournalMock,
  knowledgeAcquireMock,
  knowledgeDrainMock,
  knowledgeReleaseMock,
  fileManagerAcquireMock,
  fileManagerDrainMock,
  fileManagerReleaseMock,
  fileStorageAcquireMock,
  fileStorageDrainMock,
  fileStorageReleaseMock,
  pauseMock,
  drainInFlightMock,
  vectorCloseMock,
  vectorReleaseMock,
  mcpCloseMock,
  mcpReleaseMock,
  cacheCloseMock,
  cacheReopenMock,
  dbCloseMock,
  clearArtifactsMock,
  getPathMock,
  relaunchMock
} = vi.hoisted(() => ({
  acquireFenceMock: vi.fn(),
  drainBackupMock: vi.fn(async () => undefined),
  releaseFenceMock: vi.fn(),
  assertIdleMock: vi.fn(),
  readJournalMock: vi.fn((): { kind: string; journal?: { state: string }; error?: string } => ({
    kind: 'none'
  })),
  knowledgeAcquireMock: vi.fn(),
  knowledgeDrainMock: vi.fn(async () => undefined),
  knowledgeReleaseMock: vi.fn(),
  fileManagerAcquireMock: vi.fn(),
  fileManagerDrainMock: vi.fn(async () => undefined),
  fileManagerReleaseMock: vi.fn(),
  fileStorageAcquireMock: vi.fn(),
  fileStorageDrainMock: vi.fn(async () => undefined),
  fileStorageReleaseMock: vi.fn(),
  pauseMock: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlightMock: vi.fn(async () => ({ stragglerIds: [], startupRecoveryPending: false })),
  vectorCloseMock: vi.fn(async () => undefined),
  vectorReleaseMock: vi.fn(),
  mcpCloseMock: vi.fn(async () => undefined),
  mcpReleaseMock: vi.fn(),
  cacheCloseMock: vi.fn(async () => undefined),
  cacheReopenMock: vi.fn(async () => undefined),
  dbCloseMock: vi.fn(),
  clearArtifactsMock: vi.fn(),
  getPathMock: vi.fn(),
  relaunchMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      const map: Record<string, unknown> = {
        BackupService: {
          acquireDevResetFence: acquireFenceMock,
          drainForDevReset: drainBackupMock,
          releaseDevResetFence: releaseFenceMock,
          assertIdleForDevReset: assertIdleMock
        },
        KnowledgeService: {
          acquireDevResetMutationGate: knowledgeAcquireMock,
          drainDevResetMutations: knowledgeDrainMock,
          releaseDevResetMutationGate: knowledgeReleaseMock
        },
        FileManager: {
          acquireDevResetMutationGate: fileManagerAcquireMock,
          drainDevResetMutations: fileManagerDrainMock,
          releaseDevResetMutationGate: fileManagerReleaseMock
        },
        JobManager: { pause: pauseMock, drainInFlight: drainInFlightMock },
        KnowledgeVectorStoreService: {
          closeAllForDevReset: vectorCloseMock,
          releaseDevResetLatch: vectorReleaseMock
        },
        McpRuntimeService: {
          closeAllForDevReset: mcpCloseMock,
          releaseDevResetLatch: mcpReleaseMock
        },
        CacheService: {
          closeForDevReset: cacheCloseMock,
          reopenAfterDevResetFailure: cacheReopenMock
        },
        DbService: { closeForDevReset: dbCloseMock }
      }
      const service = map[name]
      if (!service) throw new Error(`unexpected get(${name})`)
      return service
    },
    getPath: getPathMock,
    relaunch: relaunchMock
  }
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn()
  }
}))

vi.mock('@main/services/FileStorage', () => ({
  fileStorage: {
    acquireDevResetMutationGate: fileStorageAcquireMock,
    drainDevResetMutations: fileStorageDrainMock,
    releaseDevResetMutationGate: fileStorageReleaseMock
  }
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: readJournalMock
}))

vi.mock('@main/data/db/restore/clearTerminalRestoreArtifacts', () => ({
  clearTerminalRestoreArtifacts: clearArtifactsMock
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

describe('DevResetCoordinator', () => {
  let userDataRoot: string

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-reset-coordinator-'))
    getPathMock.mockImplementation((key: string) => {
      if (key === 'app.userdata') return userDataRoot
      if (key === 'app.database.file') return path.join(userDataRoot, 'cherrystudio.sqlite')
      if (key === 'app.userdata.data') return path.join(userDataRoot, 'Data')
      if (key === 'feature.backup.restore.file') return path.join(userDataRoot, 'restore-journal.json')
      if (key === 'feature.backup.restore.staging') return path.join(userDataRoot, 'restore-staging')
      return path.join(userDataRoot, key)
    })
    const dbPath = getPathMock('app.database.file')
    const dataDir = getPathMock('app.userdata.data')
    fs.writeFileSync(dbPath, 'db')
    fs.writeFileSync(`${dbPath}-wal`, 'wal')
    fs.writeFileSync(`${dbPath}-shm`, 'shm')
    fs.mkdirSync(dataDir, { recursive: true })
    readJournalMock.mockReturnValue({ kind: 'none' })
    drainInFlightMock.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(userDataRoot, { recursive: true, force: true })
  })

  it('rejects concurrent resets with DEV_RESET_BUSY', async () => {
    let resolveDrain!: () => void
    drainInFlightMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDrain = () => resolve({ stragglerIds: [], startupRecoveryPending: false })
        })
    )
    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    const first = DevResetCoordinator.reset()
    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_BUSY' })
    resolveDrain()
    await expect(first).resolves.toEqual({ ok: true, restartRequired: true })
  })

  it('rejects pending restore journals without deleting', async () => {
    readJournalMock.mockReturnValueOnce({
      kind: 'ok',
      journal: { state: 'staged' }
    })
    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_RESTORE_PENDING' })
    expect(dbCloseMock).not.toHaveBeenCalled()
    expect(fs.existsSync(getPathMock('app.database.file'))).toBe(true)
    expect(fs.existsSync(getPathMock('app.userdata.data'))).toBe(true)
    expect(releaseFenceMock).toHaveBeenCalledOnce()
  })

  it('rejects corrupt restore journals without deleting', async () => {
    readJournalMock.mockReturnValueOnce({ kind: 'corrupt', error: 'invalid json' })
    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_RESTORE_PENDING' })
    expect(knowledgeAcquireMock).not.toHaveBeenCalled()
    expect(dbCloseMock).not.toHaveBeenCalled()
    expect(fs.existsSync(getPathMock('app.database.file'))).toBe(true)
    expect(fs.existsSync(getPathMock('app.userdata.data'))).toBe(true)
    expect(releaseFenceMock).toHaveBeenCalledOnce()
  })

  it.each(['export', 'restore'] as const)('rejects an active %s operation', async (kind) => {
    assertIdleMock.mockImplementationOnce(() => {
      throw Object.assign(new Error(`${kind} busy`), { code: 'DEV_RESET_BACKUP_BUSY' })
    })
    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_BACKUP_BUSY' })
    expect(acquireFenceMock).toHaveBeenCalledOnce()
    expect(drainBackupMock).toHaveBeenCalledOnce()
    expect(fs.existsSync(getPathMock('app.database.file'))).toBe(true)
    expect(fs.existsSync(getPathMock('app.userdata.data'))).toBe(true)
    expect(releaseFenceMock).toHaveBeenCalledOnce()
  })

  it('reopens CacheService when a pre-delete barrier fails', async () => {
    cacheCloseMock.mockRejectedValueOnce(new Error('cache close failed'))
    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    await expect(DevResetCoordinator.reset()).rejects.toThrow('cache close failed')
    expect(cacheReopenMock).toHaveBeenCalledOnce()
    expect(fs.existsSync(getPathMock('app.database.file'))).toBe(true)
    expect(fs.existsSync(getPathMock('app.userdata.data'))).toBe(true)
    expect(knowledgeReleaseMock).toHaveBeenCalledOnce()
    expect(fileManagerReleaseMock).toHaveBeenCalledOnce()
    expect(fileStorageReleaseMock).toHaveBeenCalledOnce()
    expect(releaseFenceMock).toHaveBeenCalledOnce()
  })

  it('runs the barrier, deletes DB/Data, and schedules relaunch on success', async () => {
    const dbPath = getPathMock('app.database.file')
    const dataDir = getPathMock('app.userdata.data')
    const cachePath = path.join(userDataRoot, 'cache.json')
    const preferencesPath = path.join(userDataRoot, 'preferences.json')
    fs.writeFileSync(dbPath, 'db')
    fs.writeFileSync(`${dbPath}-wal`, 'wal')
    fs.writeFileSync(`${dbPath}-shm`, 'shm')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'knowledge.txt'), 'data')
    fs.writeFileSync(cachePath, '{}')
    fs.writeFileSync(preferencesPath, '{}')

    const { DevResetCoordinator } = await import('../DevResetCoordinator')
    await expect(DevResetCoordinator.reset()).resolves.toEqual({ ok: true, restartRequired: true })
    expect(acquireFenceMock).toHaveBeenCalled()
    expect(drainBackupMock).toHaveBeenCalled()
    expect(assertIdleMock).toHaveBeenCalled()
    expect(knowledgeAcquireMock).toHaveBeenCalled()
    expect(fileManagerAcquireMock).toHaveBeenCalled()
    expect(fileStorageAcquireMock).toHaveBeenCalled()
    expect(pauseMock).toHaveBeenCalledWith('dev reset')
    expect(vectorCloseMock).toHaveBeenCalled()
    expect(mcpCloseMock).toHaveBeenCalled()
    expect(cacheCloseMock).toHaveBeenCalled()
    expect(dbCloseMock).toHaveBeenCalled()
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
    expect(fs.existsSync(dataDir)).toBe(false)
    expect(fs.existsSync(cachePath)).toBe(true)
    expect(fs.existsSync(preferencesPath)).toBe(true)
    expect(fs.existsSync(userDataRoot)).toBe(true)
    expect(clearArtifactsMock).toHaveBeenCalled()
    expect(releaseFenceMock).not.toHaveBeenCalled()
    expect(relaunchMock).toHaveBeenCalledOnce()
  })

  it('fails closed when terminal restore cleanup fails after deletion begins', async () => {
    clearArtifactsMock.mockImplementationOnce(() => {
      throw new Error('restore cleanup failed')
    })
    const { DevResetCoordinator } = await import('../DevResetCoordinator')

    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_INCOMPLETE' })
    expect(knowledgeReleaseMock).not.toHaveBeenCalled()
    expect(cacheReopenMock).not.toHaveBeenCalled()
    expect(relaunchMock).not.toHaveBeenCalled()
    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_BUSY' })
  })

  it('fails closed when the database close proof fails', async () => {
    dbCloseMock.mockImplementationOnce(() => {
      throw new Error('database close uncertain')
    })
    const { DevResetCoordinator } = await import('../DevResetCoordinator')

    await expect(DevResetCoordinator.reset()).rejects.toMatchObject({ code: 'DEV_RESET_INCOMPLETE' })
    expect(knowledgeReleaseMock).not.toHaveBeenCalled()
    expect(cacheReopenMock).not.toHaveBeenCalled()
    expect(relaunchMock).not.toHaveBeenCalled()
  })
})
