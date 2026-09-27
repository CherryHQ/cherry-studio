/**
 * AssistantMigrator runs before ChatMigrator. A null assistants[] entry must
 * not fail prepare, or MigrationEngine aborts before the chat guard runs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAllMigrators } from '../../migrators/migratorRegistry'
import { MigrationEngine } from '../MigrationEngine'
import type { MigrationPaths } from '../MigrationPaths'

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: vi.fn(() => ({})),
    set: vi.fn(),
    persist: vi.fn()
  }
}))

function migrationsFolder(): string {
  return fileURLToPath(new URL('../../../../../../../migrations/sqlite-drizzle', import.meta.url))
}

function writeExport(root: string): MigrationPaths {
  const userData = join(root, 'userData')
  const cherryHome = join(root, 'cherryHome')
  const reduxDir = join(userData, 'migration_temp', 'redux_export')
  const dexieDir = join(userData, 'migration_temp', 'dexie_export')
  const localStorageDir = join(userData, 'migration_temp', 'localstorage_export')
  mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
  mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
  mkdirSync(reduxDir, { recursive: true })
  mkdirSync(dexieDir, { recursive: true })
  mkdirSync(localStorageDir, { recursive: true })
  mkdirSync(join(cherryHome, 'config'), { recursive: true })

  writeFileSync(
    join(reduxDir, 'assistants.json'),
    JSON.stringify({
      assistants: [null, { id: 'ast-valid', name: 'Valid', topics: [{ id: 'topic-valid', name: 'Kept' }] }]
    })
  )
  writeFileSync(
    join(dexieDir, 'topics.json'),
    JSON.stringify([
      {
        id: 'topic-valid',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            assistantId: 'ast-valid',
            topicId: 'topic-valid',
            createdAt: '2024-01-01T00:00:00.000Z',
            blocks: []
          }
        ]
      }
    ])
  )
  writeFileSync(join(localStorageDir, 'localStorage.json'), '[]')

  return {
    userData,
    cherryHome,
    databaseFile: join(userData, 'Data', 'cherrystudio.sqlite'),
    knowledgeBaseDir: join(userData, 'Data', 'KnowledgeBase'),
    filesDataDir: join(userData, 'Data', 'Files'),
    versionLogFile: join(userData, 'version.log'),
    legacyAgentDbFile: join(userData, 'Data', 'agents.db'),
    legacyClaudeConfigDir: join(userData, '.claude'),
    legacyClaudeProjectsDir: join(userData, '.claude', 'projects'),
    agentsDataDir: join(userData, 'Data', 'Agents'),
    claudeConfigDir: join(userData, 'Data', 'Agents', '.claude'),
    claudeProjectsDir: join(userData, 'Data', 'Agents', '.claude', 'projects'),
    agentSystemWorkspacesDir: join(userData, 'Data', 'Agents', 'system'),
    customMiniAppsFile: join(userData, 'Data', 'Files', 'custom-minapps.json'),
    migrationTempDir: join(userData, 'migration_temp'),
    migrationReduxExportDir: reduxDir,
    migrationDexieExportDir: dexieDir,
    migrationLocalStorageExportDir: localStorageDir,
    migrationLocalStorageExportFile: join(localStorageDir, 'localStorage.json'),
    legacyConfigFile: join(cherryHome, 'config', 'config.json'),
    migrationsFolder: migrationsFolder()
  }
}

describe('null assistant export', () => {
  let root: string | undefined
  let engine: MigrationEngine | undefined

  afterEach(() => {
    engine?.close()
    engine = undefined
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('survives the production migration chain and keeps the valid assistant topic', async () => {
    root = mkdtempSync(join(tmpdir(), 'cherry-null-assistant-'))
    const paths = writeExport(root)
    engine = new MigrationEngine()
    engine.initialize(paths)
    engine.registerMigrators(getAllMigrators())

    const result = await engine.run(
      paths.migrationReduxExportDir,
      paths.migrationDexieExportDir,
      paths.migrationLocalStorageExportFile
    )

    expect(result.success, result.error).toBe(true)

    const db = (engine as unknown as { migrationDb: { getDb(): DbType } }).migrationDb.getDb()
    const assistants = db.select().from(assistantTable).all()
    expect(assistants.map((row) => ({ id: row.id, name: row.name }))).toEqual([{ id: 'ast-valid', name: 'Valid' }])

    const topic = db.select().from(topicTable).where(eq(topicTable.id, 'topic-valid')).get()
    expect(topic).toMatchObject({ id: 'topic-valid', name: 'Kept', assistantId: 'ast-valid' })
  }, 120_000)
})
