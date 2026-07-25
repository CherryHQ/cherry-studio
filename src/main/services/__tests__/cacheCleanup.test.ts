import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { inspectCacheCleanup, runCacheCleanup } from '@main/services/cacheCleanup'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { app, session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootConfigGet = vi.hoisted(() => vi.fn())
const { defaultSession, webviewSession } = vi.hoisted(() => {
  const createSession = () => ({
    clearCodeCaches: vi.fn(),
    clearData: vi.fn(),
    clearStorageData: vi.fn(),
    getCacheSize: vi.fn()
  })
  return { defaultSession: createSession(), webviewSession: createSession() }
})

vi.mock('@data/bootConfig', () => ({
  bootConfigService: { get: bootConfigGet }
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
    fromPartition: vi.fn(() => webviewSession)
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

describe('cacheCleanup', () => {
  const dbh = setupTestDatabase()
  let root: string
  let tracePath: string

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
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-cleanup-test-'))
    tracePath = rootPath('Trace')
    vi.mocked(app.getPath).mockImplementation((name) => (name === 'exe' ? rootPath('CherryStudio') : '/mock/path'))

    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const paths: Record<string, string> = {
        'app.userdata': root,
        'app.userdata.data': rootPath('Data'),
        'app.session': rootPath('Session'),
        'app.session.webview': rootPath('Session', 'Partitions', 'webview'),
        'app.temp': rootPath('Temp'),
        'feature.trace': tracePath,
        'v1.trace': rootPath('Home', 'trace'),
        'v1.cli.install': rootPath('Home', 'install'),
        'feature.files.data': rootPath('Data', 'Files'),
        'feature.knowledgebase.data': rootPath('Data', 'KnowledgeBase'),
        'cherry.home': rootPath('Home'),
        'cherry.config': rootPath('HomeConfig')
      }
      const base = paths[key]
      if (!base) throw new Error(`Unexpected path key: ${key}`)
      return filename ? path.join(base, filename) : base
    })

    for (const mockedSession of [defaultSession, webviewSession]) {
      mockedSession.getCacheSize.mockResolvedValue(0)
      mockedSession.clearData.mockResolvedValue(undefined)
      mockedSession.clearCodeCaches.mockResolvedValue(undefined)
      mockedSession.clearStorageData.mockResolvedValue(undefined)
    }

    await fs.mkdir(rootPath('Data'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function completeMigration(): void {
    dbh.db
      .insert(appStateTable)
      .values({
        key: 'migration_v2_status',
        value: { status: 'completed' }
      })
      .run()
  }

  it('sums both Electron sessions, disk caches, temp data, and traces', async () => {
    defaultSession.getCacheSize.mockResolvedValue(100)
    webviewSession.getCacheSize.mockResolvedValue(200)

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

    const result = await inspectCacheCleanup(['normal_cache'])

    expect(result.results[0]).toMatchObject({
      group: 'normal_cache',
      allowed: true,
      size: {
        bytes: 353,
        accuracy: 'estimated',
        completeness: 'complete'
      }
    })
    expect(session.fromPartition).toHaveBeenCalledWith('persist:webview')
  })

  it('clears both the active and legacy trace directories', async () => {
    const legacyTracePath = rootPath('Home', 'trace')
    await writeTestFile(path.join(tracePath, 'active-trace'), 'active')
    await writeTestFile(path.join(legacyTracePath, 'legacy-trace'), 'legacy')
    vi.mocked(application.get).mockReturnValueOnce({
      cleanLocalData: () => fs.rm(tracePath, { recursive: true, force: true })
    } as never)

    const cleanup = await runCacheCleanup(['normal_cache'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(tracePath, legacyTracePath)
  })

  it('counts a shared disk path only once', async () => {
    tracePath = rootPath('Temp')
    await writeTestFile(path.join(tracePath, 'shared.bin'), Buffer.alloc(17))

    const result = await inspectCacheCleanup(['normal_cache'])

    expect(result.results[0]?.size.bytes).toBe(17)
  })

  it('reports a symlink as partially unknown without following it', async () => {
    const external = rootPath('External')
    await writeTestFile(path.join(external, 'secret.bin'), Buffer.alloc(23))
    await fs.symlink(external, rootPath('Temp'))

    const result = await inspectCacheCleanup(['normal_cache'])

    expect(result.results[0]?.size).toMatchObject({
      bytes: null,
      completeness: 'partial'
    })
    expect(result.results[0]?.size.issues).toContainEqual({
      item: 'app_temp',
      code: 'unsafe_target'
    })
  })

  it('blocks legacy and restore cleanup until v2 migration completes', async () => {
    const configPath = rootPath('config.json')
    await fs.writeFile(configPath, JSON.stringify({ language: 'zh-cn' }))

    const inspection = await inspectCacheCleanup(['legacy_v1', 'restore_staging'])
    const cleanup = await runCacheCleanup(['legacy_v1', 'restore_staging'])

    expect(inspection.migrationStatus).toBe('incomplete')
    expect(inspection.results.every(({ allowed }) => !allowed)).toBe(true)
    expect(cleanup.results.every(({ status }) => status === 'skipped')).toBe(true)
    await expectExisting(configPath)
  })

  it('removes exact owned files and directory trees without inspecting their contents', async () => {
    completeMigration()
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

    const groups = ['legacy_v1', 'restore_staging'] as const
    const inspection = await inspectCacheCleanup([...groups])
    const cleanup = await runCacheCleanup([...groups])

    expect(inspection.results.every(({ size }) => size.bytes !== null && size.completeness === 'complete')).toBe(true)
    expect(cleanup.results.every(({ status }) => status === 'cleared')).toBe(true)
    await expectMissing(...legacyFiles, ...legacyDirectories, ...restoreDirectories)
    await expectExisting(externalPath)
  })

  it('removes only schema-validated legacy knowledge and Memory databases', async () => {
    completeMigration()
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

    const inspection = await inspectCacheCleanup(['legacy_v1'])
    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(inspection.migrationStatus).toBe('completed')
    expect(inspection.results[0]?.size.bytes).toBeGreaterThan(0)
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expectMissing(legacyKnowledge, legacyMemory)
    await expectExisting(unrelatedKnowledge, v2Knowledge, unrelatedMemory)
  })

  it('does not follow a symbolic-link ancestor to a legacy database', async () => {
    completeMigration()
    const externalMemoryDirectory = rootPath('ExternalMemory')
    const externalMemory = path.join(externalMemoryDirectory, 'memories.db')
    await fs.mkdir(externalMemoryDirectory)
    createSqlite(externalMemory, MEMORY_SCHEMA)
    await fs.symlink(externalMemoryDirectory, rootPath('Data', 'Memory'))

    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('skipped')
    await expectExisting(externalMemory)
    await expect(fs.lstat(rootPath('Data', 'Memory'))).resolves.toBeDefined()
  })

  it('preserves a root agents.db copy when any SQLite sidecar differs', async () => {
    completeMigration()
    const dataAgents = rootPath('Data', 'agents.db')
    const rootAgents = rootPath('agents.db')
    createSqlite(dataAgents, 'CREATE TABLE agents (id TEXT PRIMARY KEY)')
    await fs.copyFile(dataAgents, rootAgents)
    await fs.writeFile(`${dataAgents}-wal`, 'data-sidecar')
    await fs.writeFile(`${rootAgents}-wal`, 'root-sidecar')

    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('partial')
    await expectMissing(dataAgents, `${dataAgents}-wal`)
    await expectExisting(rootAgents)
    await expect(fs.readFile(`${rootAgents}-wal`, 'utf8')).resolves.toBe('root-sidecar')
  })

  it('removes only the current installation mapping from the shared legacy config', async () => {
    completeMigration()
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

    const cleanup = await runCacheCleanup(['legacy_v1'])
    const updated = JSON.parse(await fs.readFile(homeConfigPath, 'utf8'))

    expect(cleanup.results[0]?.status).toBe('cleared')
    expect(updated).toEqual({
      appDataPath: [{ executablePath: '/other/CherryStudio', dataPath: '/other/data' }],
      retainedField: true
    })
    expect(app.getPath).toHaveBeenCalledWith('exe')
  })

  it('serializes concurrent cleanup requests', async () => {
    let finishFirstCleanup: (() => void) | undefined
    const firstCleanup = new Promise<void>((resolve) => {
      finishFirstCleanup = resolve
    })
    defaultSession.clearData.mockImplementation(() => firstCleanup)

    const first = runCacheCleanup(['site_data'])
    await vi.waitFor(() => expect(defaultSession.clearData).toHaveBeenCalledTimes(1))

    const second = runCacheCleanup(['site_data'])
    await Promise.resolve()
    expect(defaultSession.clearData).toHaveBeenCalledTimes(1)

    finishFirstCleanup?.()
    await Promise.all([first, second])

    expect(defaultSession.clearData).toHaveBeenCalledTimes(2)
  })
})
