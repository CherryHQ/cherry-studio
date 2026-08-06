import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { inspectOrphanBaseArtifacts } from '@main/features/knowledge/base/orphanBaseArtifacts'
import { cacheCleanupService } from '@main/services/cacheCleanup'
import { MockMainFileManagerExport } from '@test-mocks/main/FileManager'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootConfigGet = vi.hoisted(() => vi.fn())
const hasPendingRestoreMock = vi.hoisted(() => vi.fn(() => false))
const removeOrphanBaseArtifacts = vi.hoisted(() => vi.fn())
const { defaultSession, webviewSession, htmlArtifactPreviewSession } = vi.hoisted(() => {
  const createSession = () => ({
    clearCodeCaches: vi.fn(),
    clearData: vi.fn(),
    clearStorageData: vi.fn(),
    getCacheSize: vi.fn()
  })
  return {
    defaultSession: createSession(),
    webviewSession: createSession(),
    htmlArtifactPreviewSession: createSession()
  }
})

vi.mock('@data/bootConfig', () => ({
  bootConfigService: { get: bootConfigGet }
}))

vi.mock('@data/db/restore/restoreJournal', () => ({
  hasPendingRestore: hasPendingRestoreMock
}))

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn(() => '/mock/path'),
    getPreferredSystemLanguages: vi.fn(() => ['en-US']),
    getVersion: vi.fn(() => '1.0.0')
  },
  session: {
    defaultSession,
    fromPartition: vi.fn((partition: string) =>
      partition === 'persist:webview' ? webviewSession : htmlArtifactPreviewSession
    )
  }
}))

function createSqlite(targetPath: string, schema: string): void {
  const db = new Database(targetPath)
  db.exec(schema)
  db.close()
}

const KNOWLEDGE_SCHEMA =
  'CREATE TABLE vectors (id TEXT, pageContent TEXT, uniqueLoaderId TEXT, source TEXT, vector BLOB)'
const MEMORY_SCHEMA = 'CREATE TABLE memories (id TEXT PRIMARY KEY, memory TEXT NOT NULL)'

const emptyFileSweepReport = {
  outcome: 'completed' as const,
  entriesInDb: 0,
  direntsScanned: 0,
  filesOnDisk: 0,
  bytesOnDisk: 0,
  plannedDeleteCount: 0,
  plannedDeleteBytes: 0,
  actualDeleteCount: 0,
  actualDeleteBytes: 0,
  statFailedCount: 0,
  scanDurationMs: 0
}

describe('CacheCleanupService', () => {
  let root: string
  let tracePath: string
  let userDataPath: string

  const rootPath = (...segments: string[]) => path.join(root, ...segments)

  async function writeTestFile(targetPath: string, data: string | Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, data)
  }

  async function expectMissing(...targetPaths: string[]): Promise<void> {
    for (const targetPath of targetPaths) {
      await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }

  async function expectExisting(...targetPaths: string[]): Promise<void> {
    for (const targetPath of targetPaths) {
      await expect(fs.stat(targetPath)).resolves.toBeDefined()
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    bootConfigGet.mockReset()
    bootConfigGet.mockReturnValue(undefined)
    hasPendingRestoreMock.mockReturnValue(false)
    vi.spyOn(knowledgeBaseService, 'listAllIds').mockReturnValue(new Set())
    removeOrphanBaseArtifacts.mockImplementation(async (baseId: string) => {
      if (knowledgeBaseService.listAllIds().has(baseId)) return false
      await fs.rm(rootPath('Data', 'KnowledgeBase', baseId), { recursive: true, force: false })
      return true
    })
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'FileManager') return MockMainFileManagerExport.fileManager
      if (name === 'KnowledgeService') return { inspectOrphanBaseArtifacts, removeOrphanBaseArtifacts }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }) as typeof application.get)
    MockMainFileManagerExport.fileManager.inspectOrphanFiles.mockResolvedValue(emptyFileSweepReport)
    MockMainFileManagerExport.fileManager.cleanupOrphanFiles.mockResolvedValue(emptyFileSweepReport)
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-cleanup-test-'))
    userDataPath = root
    tracePath = rootPath('Trace')
    vi.mocked(app.getPath).mockImplementation((name) => (name === 'exe' ? rootPath('CherryStudio') : '/mock/path'))

    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const paths: Record<string, string> = {
        'app.userdata': userDataPath,
        'app.userdata.data': path.join(userDataPath, 'Data'),
        'app.session': rootPath('Session'),
        'app.session.webview': rootPath('Session', 'Partitions', 'webview'),
        'app.temp': rootPath('Temp'),
        'feature.trace': tracePath,
        'v1.trace': rootPath('Home', 'trace'),
        'v1.cli.install': rootPath('Home', 'install'),
        'v1.database.file': path.join(userDataPath, 'cherrystudio.sqlite'),
        'v1.agents.claude': path.join(userDataPath, '.claude'),
        'feature.backup.restore.file': path.join(userDataPath, 'restore-journal.json'),
        'feature.files.data': path.join(userDataPath, 'Data', 'Files'),
        'feature.knowledgebase.data': path.join(userDataPath, 'Data', 'KnowledgeBase'),
        'cherry.home': rootPath('Home'),
        'cherry.config': rootPath('HomeConfig')
      }
      const base = paths[key]
      if (!base) throw new Error(`Unexpected path key: ${key}`)
      return filename ? path.join(base, filename) : base
    })

    for (const mockedSession of [defaultSession, webviewSession, htmlArtifactPreviewSession]) {
      mockedSession.getCacheSize.mockResolvedValue(0)
      mockedSession.clearData.mockResolvedValue(undefined)
      mockedSession.clearCodeCaches.mockResolvedValue(undefined)
      mockedSession.clearStorageData.mockResolvedValue(undefined)
    }

    await fs.mkdir(rootPath('Data'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('sums all Electron sessions, disk caches, and traces without counting shared temp data', async () => {
    defaultSession.getCacheSize.mockResolvedValue(100)
    webviewSession.getCacheSize.mockResolvedValue(200)
    htmlArtifactPreviewSession.getCacheSize.mockResolvedValue(300)

    const files = [
      [rootPath('Session', 'Code Cache', 'default.bin'), 5],
      [rootPath('Session', 'Partitions', 'webview', 'Code Cache', 'webview.bin'), 7],
      [rootPath('Temp', 'temp.bin'), 11],
      [rootPath('Trace', 'trace.bin'), 13],
      [rootPath('Home', 'trace', 'legacy-trace.bin'), 17]
    ] as const
    for (const [filePath, size] of files) {
      await writeTestFile(filePath, Buffer.alloc(size))
    }

    const result = await cacheCleanupService.inspect(['normal_cache'])

    expect(result.results[0]).toMatchObject({
      group: 'normal_cache',
      size: {
        bytes: 642,
        accuracy: 'estimated',
        completeness: 'complete'
      }
    })
  })

  it('reports site-data inspection as partial when the preview partition cannot be measured', async () => {
    await writeTestFile(rootPath('Session', 'Partitions', 'webview', 'Local Storage', 'data.bin'), Buffer.alloc(17))

    const result = await cacheCleanupService.inspect(['site_data'])

    expect(result.results[0]).toMatchObject({
      group: 'site_data',
      size: {
        bytes: 17,
        accuracy: 'estimated',
        completeness: 'partial'
      }
    })
  })

  it('clears both the active and legacy trace directories', async () => {
    const legacyTracePath = rootPath('Home', 'trace')
    const activeTempPath = rootPath('Temp', 'active-operation.tmp')
    await writeTestFile(path.join(tracePath, 'active-trace'), 'active')
    await writeTestFile(path.join(legacyTracePath, 'legacy-trace'), 'legacy')
    await writeTestFile(activeTempPath, 'keep')
    vi.mocked(application.get).mockReturnValueOnce({
      cleanLocalData: () => fs.rm(tracePath, { recursive: true, force: true })
    } as never)

    const cleanup = await cacheCleanupService.run(['normal_cache'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(tracePath, legacyTracePath)
    await expectExisting(activeTempPath)
    for (const mockedSession of [defaultSession, webviewSession, htmlArtifactPreviewSession]) {
      expect(mockedSession.clearData).toHaveBeenCalledWith({
        dataTypes: ['cache'],
        avoidClosingConnections: true
      })
    }
  })

  it('keeps default-session connections open while clearing site cookies', async () => {
    const cleanup = await cacheCleanupService.run(['site_data'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    expect(defaultSession.clearData).toHaveBeenCalledWith({
      dataTypes: ['cookies'],
      avoidClosingConnections: true
    })
  })

  it('counts a shared disk path only once', async () => {
    tracePath = rootPath('Temp')
    await writeTestFile(path.join(tracePath, 'shared.bin'), Buffer.alloc(17))

    const result = await cacheCleanupService.inspect(['normal_cache'])

    expect(result.results[0]?.size.bytes).toBe(17)
  })

  it('reports a symlink as partially unknown without following it', async () => {
    const external = rootPath('External')
    await writeTestFile(path.join(external, 'secret.bin'), Buffer.alloc(23))
    await fs.mkdir(rootPath('Home'), { recursive: true })
    await fs.symlink(external, rootPath('Home', 'trace'))

    const result = await cacheCleanupService.inspect(['normal_cache'])

    expect(result.results[0]?.size).toMatchObject({
      bytes: null,
      completeness: 'partial'
    })
    expect(result.results[0]?.size).not.toHaveProperty('issues')
  })

  it('counts and removes old orphan files and UUID knowledge base directories only', async () => {
    const knownBaseId = '11111111-1111-4111-8111-111111111111'
    const orphanBaseId = '22222222-2222-4222-8222-222222222222'
    const knownBasePath = rootPath('Data', 'KnowledgeBase', knownBaseId)
    const orphanBasePath = rootPath('Data', 'KnowledgeBase', orphanBaseId)
    const unknownDirectory = rootPath('Data', 'KnowledgeBase', 'custom-data')
    await writeTestFile(path.join(knownBasePath, 'raw', 'keep.md'), 'keep')
    await writeTestFile(path.join(orphanBasePath, '.cherry', 'index.sqlite'), Buffer.alloc(11))
    await writeTestFile(path.join(unknownDirectory, 'keep.bin'), 'keep')
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000)
    await fs.utimes(orphanBasePath, oldMtime, oldMtime)
    vi.mocked(knowledgeBaseService.listAllIds).mockReturnValue(new Set([knownBaseId]))
    MockMainFileManagerExport.fileManager.inspectOrphanFiles.mockResolvedValue({
      ...emptyFileSweepReport,
      plannedDeleteCount: 1,
      plannedDeleteBytes: 7
    })
    MockMainFileManagerExport.fileManager.cleanupOrphanFiles.mockResolvedValue({
      ...emptyFileSweepReport,
      plannedDeleteCount: 1,
      plannedDeleteBytes: 7,
      actualDeleteCount: 1,
      actualDeleteBytes: 7
    })

    const inspection = await cacheCleanupService.inspect(['orphaned_data'])
    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(inspection.results[0]).toMatchObject({
      group: 'orphaned_data',
      size: { bytes: 18, accuracy: 'exact', completeness: 'complete' }
    })
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(orphanBasePath)
    await expectExisting(knownBasePath, unknownDirectory)
  })

  it('does not advertise bytes from an orphan-file plan that the safety threshold aborts', async () => {
    MockMainFileManagerExport.fileManager.inspectOrphanFiles.mockResolvedValue({
      ...emptyFileSweepReport,
      outcome: 'aborted',
      abortReason: 'count-fraction',
      plannedDeleteCount: 25,
      plannedDeleteBytes: 4096
    })

    const inspection = await cacheCleanupService.inspect(['orphaned_data'])

    expect(inspection.results[0]?.size).toEqual({
      bytes: null,
      accuracy: 'unavailable',
      completeness: 'partial'
    })
  })

  it('preserves a fresh UUID knowledge base directory without a database row', async () => {
    const freshBaseId = '22222222-2222-4222-8222-222222222223'
    const freshBasePath = rootPath('Data', 'KnowledgeBase', freshBaseId)
    await writeTestFile(path.join(freshBasePath, '.cherry', 'index.sqlite'), 'new')

    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(cleanup.results[0]?.status).toBe('not_found')
    await expectExisting(freshBasePath)
  })

  it('reports orphan-file stat failures instead of successful cleanup', async () => {
    MockMainFileManagerExport.fileManager.cleanupOrphanFiles.mockResolvedValue({
      ...emptyFileSweepReport,
      statFailedCount: 1
    })

    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(cleanup.results[0]?.status).toBe('failed')

    MockMainFileManagerExport.fileManager.cleanupOrphanFiles.mockResolvedValue({
      ...emptyFileSweepReport,
      actualDeleteCount: 1,
      statFailedCount: 1
    })

    const partialCleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(partialCleanup.results[0]?.status).toBe('partial')
  })

  it('rechecks knowledge base ownership immediately before deleting an old orphan directory', async () => {
    const baseId = '22222222-2222-4222-8222-222222222224'
    const basePath = rootPath('Data', 'KnowledgeBase', baseId)
    await writeTestFile(path.join(basePath, '.cherry', 'index.sqlite'), 'keep')
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000)
    await fs.utimes(basePath, oldMtime, oldMtime)
    vi.mocked(knowledgeBaseService.listAllIds)
      .mockReturnValueOnce(new Set())
      .mockReturnValueOnce(new Set([baseId]))

    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(cleanup.results[0]?.status).toBe('not_found')
    expect(removeOrphanBaseArtifacts).toHaveBeenCalledWith(baseId)
    await expectExisting(basePath)
  })

  it('stands aside when a restore becomes pending after orphan knowledge planning', async () => {
    const baseId = '22222222-2222-4222-8222-222222222225'
    const basePath = rootPath('Data', 'KnowledgeBase', baseId)
    await writeTestFile(path.join(basePath, '.cherry', 'index.sqlite'), 'keep')
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000)
    await fs.utimes(basePath, oldMtime, oldMtime)
    let finishFileSweep!: () => void
    MockMainFileManagerExport.fileManager.cleanupOrphanFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFileSweep = () => resolve(emptyFileSweepReport)
        })
    )

    const cleanup = cacheCleanupService.run(['orphaned_data'])
    await vi.waitFor(() => expect(knowledgeBaseService.listAllIds).toHaveBeenCalled())
    hasPendingRestoreMock.mockReturnValue(true)
    finishFileSweep()

    await expect(cleanup).resolves.toMatchObject({ results: [{ status: 'partial' }] })
    expect(removeOrphanBaseArtifacts).not.toHaveBeenCalled()
    await expectExisting(basePath)
  })

  it('does not follow a UUID-named knowledge base symlink', async () => {
    const orphanBaseId = '33333333-3333-4333-8333-333333333333'
    const externalBase = rootPath('ExternalKnowledge')
    const orphanLink = rootPath('Data', 'KnowledgeBase', orphanBaseId)
    await writeTestFile(path.join(externalBase, 'keep.bin'), 'keep')
    await fs.mkdir(path.dirname(orphanLink), { recursive: true })
    await fs.symlink(externalBase, orphanLink)

    const inspection = await cacheCleanupService.inspect(['orphaned_data'])
    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(inspection.results[0]?.size).toMatchObject({ bytes: null, completeness: 'partial' })
    expect(cleanup.results[0]?.status).toBe('partial')
    await expectExisting(externalBase)
    await expect(fs.lstat(orphanLink)).resolves.toBeDefined()
  })

  it('does not inspect a knowledge base root through a symbolic-link parent', async () => {
    const orphanBaseId = '33333333-3333-4333-8333-333333333334'
    const externalData = rootPath('ExternalData')
    const externalBase = path.join(externalData, 'KnowledgeBase', orphanBaseId)
    await fs.rm(rootPath('Data'), { recursive: true })
    await writeTestFile(path.join(externalBase, '.cherry', 'index.sqlite'), 'keep')
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000)
    await fs.utimes(externalBase, oldMtime, oldMtime)
    await fs.symlink(externalData, rootPath('Data'))

    const inspection = await cacheCleanupService.inspect(['orphaned_data'])
    const cleanup = await cacheCleanupService.run(['orphaned_data'])

    expect(inspection.results[0]?.size).toMatchObject({ bytes: null, completeness: 'partial' })
    expect(cleanup.results[0]?.status).toBe('partial')
    await expectExisting(externalBase)
  })

  it('removes exact owned files and directory trees without inspecting their contents', async () => {
    const legacyFiles = [
      rootPath('config.json'),
      rootPath('window-state.json'),
      rootPath('miniWindow-state.json'),
      rootPath('quickAssistant-state.json'),
      rootPath('Data', 'Files', 'custom-minapps.json')
    ]
    const legacyDirectories = [rootPath('migration_temp'), rootPath('Home', 'install')]
    const restoreDirectories = [
      rootPath('Data.restore'),
      rootPath('IndexedDB.restore'),
      rootPath('Local Storage.restore')
    ]
    const externalPath = rootPath('external-data')

    for (const targetPath of legacyFiles) {
      await writeTestFile(targetPath, 'not-json')
    }
    for (const targetPath of [...legacyDirectories, ...restoreDirectories]) {
      await writeTestFile(path.join(targetPath, 'custom', 'unknown.bin'), 'remove')
    }
    await fs.mkdir(externalPath)
    await fs.symlink(externalPath, path.join(legacyDirectories[0], 'custom', 'external-link'))
    await fs.symlink(externalPath, path.join(restoreDirectories[0], 'custom', 'external-link'))

    const groups = ['legacy_v1', 'orphaned_data'] as const
    const inspection = await cacheCleanupService.inspect([...groups])
    const cleanup = await cacheCleanupService.run([...groups])

    expect(inspection.results.every(({ size }) => size.bytes !== null && size.completeness === 'complete')).toBe(true)
    expect(cleanup.results.every(({ status }) => status === 'cleared')).toBe(true)
    await expectMissing(...legacyFiles, ...legacyDirectories, ...restoreDirectories)
    await expectExisting(externalPath)
  })

  it('does not remove a legacy directory that contains the active userData directory', async () => {
    const legacyInstallPath = rootPath('Home', 'install')
    userDataPath = path.join(legacyInstallPath, 'active-profile')
    const activeDatabase = path.join(userDataPath, 'Data', 'cherrystudio.sqlite')
    await writeTestFile(activeDatabase, 'active')

    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('skipped')
    await expectExisting(activeDatabase)
  })

  it('counts and removes the root legacy database and Claude config without touching v2 data', async () => {
    const legacyDatabase = rootPath('cherrystudio.sqlite')
    const legacyClaude = rootPath('.claude')
    const legacyFiles = [
      [legacyDatabase, 3],
      [`${legacyDatabase}-wal`, 5],
      [`${legacyDatabase}-shm`, 7],
      [`${legacyDatabase}-journal`, 11],
      [path.join(legacyClaude, 'settings.json'), 13]
    ] as const
    const v2Database = rootPath('Data', 'cherrystudio.sqlite')
    const v2ClaudeSettings = rootPath('Data', 'Agents', '.claude', 'settings.json')

    for (const [targetPath, size] of legacyFiles) {
      await writeTestFile(targetPath, Buffer.alloc(size))
    }
    await writeTestFile(v2Database, 'keep-v2-database')
    await writeTestFile(v2ClaudeSettings, 'keep-v2-claude')

    const inspection = await cacheCleanupService.inspect(['legacy_v1'])
    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(inspection.results[0]?.size.bytes).toBe(39)
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(...legacyFiles.map(([targetPath]) => targetPath), legacyClaude)
    await expectExisting(v2Database, v2ClaudeSettings)
  })

  it('removes only schema-validated legacy knowledge databases and preserves Memory data', async () => {
    const knowledgeRoot = rootPath('Data', 'KnowledgeBase')
    const legacyKnowledge = path.join(knowledgeRoot, 'legacy-base')
    const unrelatedKnowledge = path.join(knowledgeRoot, 'unrelated.db')
    const v2Knowledge = path.join(knowledgeRoot, 'v2-base', '.cherry', 'index.sqlite')
    const legacyMemory = rootPath('Data', 'Memory', 'memories.db')
    const unrelatedMemory = rootPath('Data', 'Memory', 'notes.db')

    await fs.mkdir(path.dirname(v2Knowledge), { recursive: true })
    await fs.mkdir(path.dirname(legacyMemory), { recursive: true })
    createSqlite(legacyKnowledge, KNOWLEDGE_SCHEMA)
    createSqlite(unrelatedKnowledge, 'CREATE TABLE vectors (id TEXT)')
    createSqlite(v2Knowledge, KNOWLEDGE_SCHEMA)
    createSqlite(legacyMemory, MEMORY_SCHEMA)
    createSqlite(unrelatedMemory, MEMORY_SCHEMA)

    const inspection = await cacheCleanupService.inspect(['legacy_v1'])
    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(inspection.results[0]?.size.bytes).toBeGreaterThan(0)
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(legacyKnowledge)
    await expectExisting(unrelatedKnowledge, v2Knowledge, legacyMemory, unrelatedMemory)
  })

  it('does not create SQLite sidecars beside a WAL-mode database during inspection', async () => {
    const legacyMemory = rootPath('memories.db')
    const db = new Database(legacyMemory)
    db.pragma('journal_mode = WAL')
    db.exec(MEMORY_SCHEMA)
    db.close()
    await fs.rm(`${legacyMemory}-wal`, { force: true })
    await fs.rm(`${legacyMemory}-shm`, { force: true })

    const inspection = await cacheCleanupService.inspect(['legacy_v1'])

    expect(inspection.results[0]?.size.completeness).toBe('complete')
    await expectMissing(`${legacyMemory}-wal`, `${legacyMemory}-shm`)
  })

  it('does not follow a symbolic link at the legacy database path', async () => {
    const externalMemoryDirectory = rootPath('ExternalMemory')
    const externalMemory = path.join(externalMemoryDirectory, 'memories.db')
    await fs.mkdir(externalMemoryDirectory)
    createSqlite(externalMemory, MEMORY_SCHEMA)
    await fs.symlink(externalMemory, rootPath('memories.db'))

    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('skipped')
    await expectExisting(externalMemory)
    await expect(fs.lstat(rootPath('memories.db'))).resolves.toBeDefined()
  })

  it('preserves a root agents.db copy when any SQLite sidecar differs', async () => {
    const dataAgents = rootPath('Data', 'agents.db')
    const rootAgents = rootPath('agents.db')
    createSqlite(dataAgents, 'CREATE TABLE agents (id TEXT PRIMARY KEY)')
    await fs.copyFile(dataAgents, rootAgents)
    await fs.writeFile(`${dataAgents}-wal`, 'data-sidecar')
    await fs.writeFile(`${rootAgents}-wal`, 'root-sidecar')

    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('partial')
    await expectMissing(dataAgents, `${dataAgents}-wal`)
    await expectExisting(rootAgents)
    await expect(fs.readFile(`${rootAgents}-wal`, 'utf8')).resolves.toBe('root-sidecar')
  })

  it('removes only the current installation mapping from the shared legacy config', async () => {
    const executablePath = rootPath('CherryStudio')
    const homeConfigPath = rootPath('HomeConfig', 'config.json')
    bootConfigGet.mockReturnValue({ [executablePath]: root })
    await writeTestFile(
      homeConfigPath,
      JSON.stringify({
        appDataPath: [
          { executablePath, dataPath: root },
          { executablePath: '/other/CherryStudio', dataPath: '/other/data' }
        ],
        retainedField: true
      })
    )

    const cleanup = await cacheCleanupService.run(['legacy_v1'])
    const updated = JSON.parse(await fs.readFile(homeConfigPath, 'utf8'))

    expect(cleanup.results[0]?.status).toBe('cleared')
    expect(updated).toEqual({
      appDataPath: [{ executablePath: '/other/CherryStudio', dataPath: '/other/data' }],
      retainedField: true
    })
  })

  it('recomputes the shared legacy config update after acquiring its cross-process lock', async () => {
    const executablePath = rootPath('CherryStudio')
    const homeConfigPath = rootPath('HomeConfig', 'config.json')
    const lockPath = `${homeConfigPath}.cleanup.lock`
    const otherEntry = { executablePath: '/other/CherryStudio', dataPath: '/other/data' }
    const concurrentEntry = { executablePath: '/concurrent/CherryStudio', dataPath: '/concurrent/data' }
    bootConfigGet.mockReturnValue({ [executablePath]: root })
    await writeTestFile(
      homeConfigPath,
      JSON.stringify({ appDataPath: [{ executablePath, dataPath: root }, otherEntry], retainedField: true })
    )
    await writeTestFile(lockPath, 'held by another process')

    let resolveLockAttempt!: () => void
    const lockAttempted = new Promise<void>((resolve) => {
      resolveLockAttempt = resolve
    })
    const originalOpen = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (targetPath, flags, mode) => {
      try {
        return await originalOpen(targetPath, flags, mode)
      } finally {
        if (targetPath === lockPath && flags === 'wx') resolveLockAttempt()
      }
    })

    const cleanup = cacheCleanupService.run(['legacy_v1'])
    await lockAttempted
    await fs.writeFile(
      homeConfigPath,
      JSON.stringify({
        appDataPath: [{ executablePath, dataPath: root }, otherEntry, concurrentEntry],
        retainedField: true,
        concurrentField: 'keep'
      })
    )
    await fs.unlink(lockPath)

    await expect(cleanup).resolves.toMatchObject({ results: [{ status: 'cleared' }] })
    await expect(fs.readFile(homeConfigPath, 'utf8').then(JSON.parse)).resolves.toEqual({
      appDataPath: [otherEntry, concurrentEntry],
      retainedField: true,
      concurrentField: 'keep'
    })
  })

  it('takes over an expired shared-config lock before applying cleanup', async () => {
    const executablePath = rootPath('CherryStudio')
    const homeConfigPath = rootPath('HomeConfig', 'config.json')
    const lockPath = `${homeConfigPath}.cleanup.lock`
    bootConfigGet.mockReturnValue({ [executablePath]: root })
    await writeTestFile(
      homeConfigPath,
      JSON.stringify({ appDataPath: [{ executablePath, dataPath: root }], retainedField: true })
    )
    await writeTestFile(lockPath, 'abandoned')
    const expired = new Date(Date.now() - 31_000)
    await fs.utimes(lockPath, expired, expired)

    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(lockPath, `${lockPath}.takeover`)
    await expect(fs.readFile(homeConfigPath, 'utf8').then(JSON.parse)).resolves.toEqual({
      appDataPath: [],
      retainedField: true
    })
  })

  it('does not follow the old predictable cleanup temp-file symlink', async () => {
    const executablePath = rootPath('CherryStudio')
    const homeConfigPath = rootPath('HomeConfig', 'config.json')
    const predictableTempPath = `${homeConfigPath}.cleanup.tmp`
    const externalPath = rootPath('external-config.json')
    bootConfigGet.mockReturnValue({ [executablePath]: root })
    await writeTestFile(
      homeConfigPath,
      JSON.stringify({ appDataPath: [{ executablePath, dataPath: root }], retainedField: true })
    )
    await writeTestFile(externalPath, 'external-data')
    await fs.symlink(externalPath, predictableTempPath)

    const cleanup = await cacheCleanupService.run(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.readFile(externalPath, 'utf8')).resolves.toBe('external-data')
    await expect(fs.lstat(predictableTempPath)).resolves.toMatchObject({})
    await expect(fs.readFile(homeConfigPath, 'utf8').then(JSON.parse)).resolves.toEqual({
      appDataPath: [],
      retainedField: true
    })
  })

  it('serializes concurrent cleanup requests', async () => {
    let finishFirstCleanup: (() => void) | undefined
    const firstCleanup = new Promise<void>((resolve) => {
      finishFirstCleanup = resolve
    })
    defaultSession.clearData.mockImplementation(() => firstCleanup)

    const first = cacheCleanupService.run(['site_data'])
    await vi.waitFor(() => expect(defaultSession.clearData).toHaveBeenCalledTimes(1))

    const second = cacheCleanupService.run(['site_data'])
    await Promise.resolve()
    expect(defaultSession.clearData).toHaveBeenCalledTimes(1)

    finishFirstCleanup?.()
    await Promise.all([first, second])

    expect(defaultSession.clearData).toHaveBeenCalledTimes(2)
  })
})
