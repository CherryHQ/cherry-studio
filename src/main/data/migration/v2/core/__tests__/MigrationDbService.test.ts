import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { MigrationDbService } from '../MigrationDbService'
import type { MigrationPaths } from '../MigrationPaths'

describe('MigrationDbService', () => {
  const fixtureRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      fixtureRoots.splice(0).map(async (root) => {
        await fs.chmod(path.join(root, 'Data'), 0o755).catch(() => {})
        await fs.chmod(path.join(root, 'Data', 'cherrystudio.sqlite'), 0o644).catch(() => {})
        await fs.chmod(root, 0o755).catch(() => {})
        await fs.rm(root, { recursive: true, force: true })
      })
    )
  })

  it('surfaces a read-only WAL failure before attempting schema migration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-db-readonly-'))
    fixtureRoots.push(root)
    const dataDir = path.join(root, 'Data')
    const databaseFile = path.join(dataDir, 'cherrystudio.sqlite')
    await fs.mkdir(dataDir)

    const setupDb = new Database(databaseFile)
    setupDb.pragma('user_version = 1')
    setupDb.close()

    await fs.chmod(databaseFile, 0o444)
    await fs.chmod(dataDir, 0o555)

    const paths = {
      userData: root,
      cherryHome: root,
      databaseFile,
      knowledgeBaseDir: path.join(dataDir, 'KnowledgeBase'),
      filesDataDir: path.join(dataDir, 'Files'),
      versionLogFile: path.join(root, 'version.log'),
      legacyAgentDbFile: path.join(dataDir, 'agents.db'),
      legacyClaudeConfigDir: path.join(root, '.claude'),
      legacyClaudeProjectsDir: path.join(root, '.claude', 'projects'),
      agentsDataDir: path.join(dataDir, 'Agents'),
      claudeConfigDir: path.join(dataDir, 'Agents', '.claude'),
      claudeProjectsDir: path.join(dataDir, 'Agents', '.claude', 'projects'),
      agentSystemWorkspacesDir: path.join(dataDir, 'Agents', 'system'),
      customMiniAppsFile: path.join(dataDir, 'Files', 'custom-minapps.json'),
      migrationTempDir: path.join(root, 'migration_temp'),
      migrationReduxExportDir: path.join(root, 'migration_temp', 'redux_export'),
      migrationDexieExportDir: path.join(root, 'migration_temp', 'dexie_export'),
      migrationLocalStorageExportDir: path.join(root, 'migration_temp', 'localstorage_export'),
      migrationLocalStorageExportFile: path.join(root, 'migration_temp', 'localstorage_export', 'localStorage.json'),
      legacyConfigFile: path.join(root, 'config.json'),
      migrationsFolder: resolveMigrationsPath()
    } satisfies MigrationPaths

    let thrown: unknown
    try {
      MigrationDbService.create(paths)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'MigrationDatabaseError',
      stage: 'wal',
      cause: { code: expect.stringMatching(/^SQLITE_READONLY/) }
    })

    const probe = new Database(databaseFile, { readonly: true })
    const migrationTable = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get()
    probe.close()
    expect(migrationTable).toBeUndefined()
  })
})
