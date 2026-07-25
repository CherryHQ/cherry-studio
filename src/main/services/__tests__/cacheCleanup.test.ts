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
const webviewSession = vi.hoisted(() => ({
  clearCodeCaches: vi.fn(),
  clearData: vi.fn(),
  clearStorageData: vi.fn(),
  getCacheSize: vi.fn()
}))

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
    defaultSession: {
      clearCodeCaches: vi.fn(),
      clearData: vi.fn(),
      clearStorageData: vi.fn(),
      getCacheSize: vi.fn()
    },
    fromPartition: vi.fn(() => webviewSession)
  }
}))

function createSqlite(targetPath: string, schema: string): void {
  const db = new Database(targetPath)
  db.exec(schema)
  db.close()
}

describe('cacheCleanup', () => {
  const dbh = setupTestDatabase()
  let root: string
  let tracePath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    bootConfigGet.mockReset()
    bootConfigGet.mockReturnValue(undefined)
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-cleanup-test-'))
    tracePath = path.join(root, 'Trace')
    vi.mocked(app.getPath).mockImplementation((name) =>
      name === 'exe' ? path.join(root, 'CherryStudio') : '/mock/path'
    )

    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const paths: Record<string, string> = {
        'app.userdata': root,
        'app.userdata.data': path.join(root, 'Data'),
        'app.session': path.join(root, 'Session'),
        'app.session.webview': path.join(root, 'Session', 'Partitions', 'webview'),
        'app.temp': path.join(root, 'Temp'),
        'feature.trace': tracePath,
        'v1.trace': path.join(root, 'Home', 'trace'),
        'v1.cli.install': path.join(root, 'Home', 'install'),
        'feature.files.data': path.join(root, 'Data', 'Files'),
        'feature.knowledgebase.data': path.join(root, 'Data', 'KnowledgeBase'),
        'cherry.home': path.join(root, 'Home'),
        'cherry.config': path.join(root, 'HomeConfig')
      }
      const base = paths[key]
      if (!base) throw new Error(`Unexpected path key: ${key}`)
      return filename ? path.join(base, filename) : base
    })

    vi.mocked(session.defaultSession.getCacheSize).mockResolvedValue(0)
    webviewSession.getCacheSize.mockResolvedValue(0)
    vi.mocked(session.defaultSession.clearData).mockResolvedValue()
    vi.mocked(session.defaultSession.clearCodeCaches).mockResolvedValue()
    vi.mocked(session.defaultSession.clearStorageData).mockResolvedValue()
    webviewSession.clearData.mockResolvedValue(undefined)
    webviewSession.clearCodeCaches.mockResolvedValue(undefined)
    webviewSession.clearStorageData.mockResolvedValue(undefined)

    await fs.mkdir(path.join(root, 'Data'), { recursive: true })
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
    vi.mocked(session.defaultSession.getCacheSize).mockResolvedValue(100)
    webviewSession.getCacheSize.mockResolvedValue(200)

    const files = [
      [path.join(root, 'Session', 'Code Cache', 'default.bin'), 5],
      [path.join(root, 'Session', 'Partitions', 'webview', 'Code Cache', 'webview.bin'), 7],
      [path.join(root, 'Temp', 'temp.bin'), 11],
      [path.join(root, 'Trace', 'trace.bin'), 13],
      [path.join(root, 'Home', 'trace', 'legacy-trace.bin'), 17]
    ] as const
    for (const [filePath, size] of files) {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, Buffer.alloc(size))
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
    const legacyTracePath = path.join(root, 'Home', 'trace')
    await fs.mkdir(tracePath, { recursive: true })
    await fs.mkdir(legacyTracePath, { recursive: true })
    await fs.writeFile(path.join(tracePath, 'active-trace'), 'active')
    await fs.writeFile(path.join(legacyTracePath, 'legacy-trace'), 'legacy')
    vi.mocked(application.get).mockReturnValueOnce({
      cleanLocalData: () => fs.rm(tracePath, { recursive: true, force: true })
    } as never)

    const cleanup = await runCacheCleanup(['normal_cache'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(tracePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(legacyTracePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('counts a shared disk path only once', async () => {
    tracePath = path.join(root, 'Temp')
    await fs.mkdir(tracePath, { recursive: true })
    await fs.writeFile(path.join(tracePath, 'shared.bin'), Buffer.alloc(17))

    const result = await inspectCacheCleanup(['normal_cache'])

    expect(result.results[0]?.size.bytes).toBe(17)
  })

  it('reports a symlink as partially unknown without following it', async () => {
    const external = path.join(root, 'External')
    await fs.mkdir(external)
    await fs.writeFile(path.join(external, 'secret.bin'), Buffer.alloc(23))
    await fs.symlink(external, path.join(root, 'Temp'))

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
    await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ language: 'zh-cn' }))

    const inspection = await inspectCacheCleanup(['legacy_v1', 'restore_staging'])
    const cleanup = await runCacheCleanup(['legacy_v1', 'restore_staging'])

    expect(inspection.migrationStatus).toBe('incomplete')
    expect(inspection.results.every(({ allowed }) => !allowed)).toBe(true)
    expect(cleanup.results.every(({ status }) => status === 'skipped')).toBe(true)
    await expect(fs.stat(path.join(root, 'config.json'))).resolves.toBeDefined()
  })

  it('removes the legacy userData config file without inspecting its contents', async () => {
    completeMigration()
    const configPath = path.join(root, 'config.json')
    await fs.writeFile(configPath, 'not-json')

    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes only schema-validated legacy knowledge and Memory databases', async () => {
    completeMigration()
    const knowledgeRoot = path.join(root, 'Data', 'KnowledgeBase')
    const legacyKnowledge = path.join(knowledgeRoot, 'legacy-base')
    const unrelatedKnowledge = path.join(knowledgeRoot, 'unrelated.db')
    const v2Knowledge = path.join(knowledgeRoot, 'v2-base', '.cherry', 'index.sqlite')
    const legacyMemory = path.join(root, 'Data', 'Memory', 'memories.db')
    const unrelatedMemory = path.join(root, 'Data', 'Memory', 'notes.db')

    await fs.mkdir(path.dirname(v2Knowledge), { recursive: true })
    await fs.mkdir(path.dirname(legacyMemory), { recursive: true })
    createSqlite(
      legacyKnowledge,
      'CREATE TABLE vectors (id TEXT, pageContent TEXT, uniqueLoaderId TEXT, source TEXT, vector BLOB)'
    )
    createSqlite(unrelatedKnowledge, 'CREATE TABLE vectors (id TEXT)')
    createSqlite(
      v2Knowledge,
      'CREATE TABLE vectors (id TEXT, pageContent TEXT, uniqueLoaderId TEXT, source TEXT, vector BLOB)'
    )
    createSqlite(legacyMemory, 'CREATE TABLE memories (id TEXT PRIMARY KEY, memory TEXT NOT NULL)')
    createSqlite(unrelatedMemory, 'CREATE TABLE memories (id TEXT PRIMARY KEY, memory TEXT NOT NULL)')

    const inspection = await inspectCacheCleanup(['legacy_v1'])
    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(inspection.migrationStatus).toBe('completed')
    expect(inspection.results[0]?.size.bytes).toBeGreaterThan(0)
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(legacyKnowledge)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(legacyMemory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(unrelatedKnowledge)).resolves.toBeDefined()
    await expect(fs.stat(v2Knowledge)).resolves.toBeDefined()
    await expect(fs.stat(unrelatedMemory)).resolves.toBeDefined()
  })

  it('does not follow a symbolic-link ancestor to a legacy database', async () => {
    completeMigration()
    const externalMemoryDirectory = path.join(root, 'ExternalMemory')
    const externalMemory = path.join(externalMemoryDirectory, 'memories.db')
    await fs.mkdir(externalMemoryDirectory)
    createSqlite(externalMemory, 'CREATE TABLE memories (id TEXT PRIMARY KEY, memory TEXT NOT NULL)')
    await fs.symlink(externalMemoryDirectory, path.join(root, 'Data', 'Memory'))

    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('skipped')
    await expect(fs.stat(externalMemory)).resolves.toBeDefined()
    await expect(fs.lstat(path.join(root, 'Data', 'Memory'))).resolves.toBeDefined()
  })

  it('preserves a root agents.db copy when any SQLite sidecar differs', async () => {
    completeMigration()
    const dataAgents = path.join(root, 'Data', 'agents.db')
    const rootAgents = path.join(root, 'agents.db')
    createSqlite(dataAgents, 'CREATE TABLE agents (id TEXT PRIMARY KEY)')
    await fs.copyFile(dataAgents, rootAgents)
    await fs.writeFile(`${dataAgents}-wal`, 'data-sidecar')
    await fs.writeFile(`${rootAgents}-wal`, 'root-sidecar')

    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(cleanup.results[0]?.status).toBe('partial')
    await expect(fs.stat(dataAgents)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(`${dataAgents}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(rootAgents)).resolves.toBeDefined()
    await expect(fs.readFile(`${rootAgents}-wal`, 'utf8')).resolves.toBe('root-sidecar')
  })

  it('removes only the current installation mapping from the shared legacy config', async () => {
    completeMigration()
    const executablePath = path.join(root, 'CherryStudio')
    const homeConfigPath = path.join(root, 'HomeConfig', 'config.json')
    bootConfigGet.mockReturnValue({ [executablePath]: root })
    await fs.mkdir(path.dirname(homeConfigPath), { recursive: true })
    await fs.writeFile(
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

  it('removes whole legacy config and restore directories without inspecting their contents', async () => {
    completeMigration()
    const configPath = path.join(root, 'config.json')
    const restorePaths = [
      path.join(root, 'Data.restore'),
      path.join(root, 'IndexedDB.restore'),
      path.join(root, 'Local Storage.restore')
    ]
    await fs.writeFile(configPath, JSON.stringify({ unknown: true }))
    for (const restorePath of restorePaths) {
      await fs.mkdir(path.join(restorePath, 'custom', 'nested'), { recursive: true })
      await fs.writeFile(path.join(restorePath, 'custom', 'nested', 'unknown.bin'), 'remove')
    }

    const inspection = await inspectCacheCleanup(['legacy_v1', 'restore_staging'])
    const cleanup = await runCacheCleanup(['legacy_v1', 'restore_staging'])

    expect(inspection.results.every(({ size }) => size.bytes !== null && size.completeness === 'complete')).toBe(true)
    expect(cleanup.results.every(({ status }) => status === 'cleared')).toBe(true)
    await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const restorePath of restorePaths) {
      await expect(fs.stat(restorePath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('removes a restore directory containing a symlink without following the link', async () => {
    completeMigration()
    const restorePath = path.join(root, 'Data.restore')
    const externalPath = path.join(root, 'external-data')
    await fs.mkdir(path.join(restorePath, 'Files'), { recursive: true })
    await fs.mkdir(externalPath)
    await fs.symlink(externalPath, path.join(restorePath, 'Files', 'external-link'))

    const inspection = await inspectCacheCleanup(['restore_staging'])
    const cleanup = await runCacheCleanup(['restore_staging'])

    expect(inspection.results[0]?.size).toMatchObject({ bytes: null, completeness: 'partial' })
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(restorePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(externalPath)).resolves.toBeDefined()
  })

  it('removes the entire migration temp directory without following nested symlinks', async () => {
    completeMigration()
    const migrationTempPath = path.join(root, 'migration_temp')
    const externalPath = path.join(root, 'external-migration-data')
    await fs.mkdir(path.join(migrationTempPath, 'custom', 'nested'), { recursive: true })
    await fs.mkdir(externalPath)
    await fs.writeFile(path.join(migrationTempPath, 'unknown.bin'), 'legacy')
    await fs.writeFile(path.join(migrationTempPath, 'custom', 'nested', 'data.json'), '{}')
    await fs.symlink(externalPath, path.join(migrationTempPath, 'external-link'))

    const inspection = await inspectCacheCleanup(['legacy_v1'])
    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(inspection.results[0]?.size.bytes).toBeGreaterThan(0)
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(migrationTempPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(externalPath)).resolves.toBeDefined()
  })

  it('counts and removes the legacy CLI install directory', async () => {
    completeMigration()
    const legacyInstallPath = path.join(root, 'Home', 'install')
    await fs.mkdir(path.join(legacyInstallPath, 'global', 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(legacyInstallPath, 'global', 'node_modules', 'legacy-cli'), 'legacy')

    const inspection = await inspectCacheCleanup(['legacy_v1'])
    const cleanup = await runCacheCleanup(['legacy_v1'])

    expect(inspection.results[0]?.size.bytes).toBeGreaterThanOrEqual(Buffer.byteLength('legacy'))
    expect(cleanup.results[0]?.status).toBe('cleared')
    await expect(fs.stat(legacyInstallPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes concurrent cleanup requests', async () => {
    let finishFirstCleanup: (() => void) | undefined
    const firstCleanup = new Promise<void>((resolve) => {
      finishFirstCleanup = resolve
    })
    vi.mocked(session.defaultSession.clearData).mockImplementation(() => firstCleanup)

    const first = runCacheCleanup(['site_data'])
    await vi.waitFor(() => expect(session.defaultSession.clearData).toHaveBeenCalledTimes(1))

    const second = runCacheCleanup(['site_data'])
    await Promise.resolve()
    expect(session.defaultSession.clearData).toHaveBeenCalledTimes(1)

    finishFirstCleanup?.()
    await Promise.all([first, second])

    expect(session.defaultSession.clearData).toHaveBeenCalledTimes(2)
  })
})
