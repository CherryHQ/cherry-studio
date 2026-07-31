import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { claudeProjectDirectoryName, legacyAgentWorkspacePath } from '../agentsFilesystemMigration'
import { AgentsMigrator } from '../AgentsMigrator'

const LEGACY_AGENT_ID = 'agent_1234567890_cachee2e1'
const LEGACY_SESSION_ID = 'session_cache_e2e'
const CLAUDE_SESSION_IDS = ['95b9a03b-6704-4a4b-bcf1-f65dabb67bf6', '3f5221a6-b39d-4cab-a82d-7a7ed7ccf5db'] as const

function seedLegacyAgentsDb(databasePath: string): void {
  const database = new Database(databasePath)
  try {
    database.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL,
        accessible_paths TEXT,
        mcps TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        accessible_paths TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        timeout_minutes INTEGER,
        status TEXT NOT NULL
      );

      CREATE TABLE channel_task_subscriptions (
        channel_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, task_id)
      );
    `)

    database
      .prepare(
        `INSERT INTO agents
          (id, type, name, instructions, accessible_paths, mcps, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        LEGACY_AGENT_ID,
        'claude_code',
        'Cache migration agent',
        'Preserve every Claude session',
        null,
        '[]',
        0,
        '2026-07-20T00:00:00.000Z',
        '2026-07-23T00:00:00.000Z'
      )
    database
      .prepare(
        `INSERT INTO sessions
          (id, agent_id, name, accessible_paths, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        LEGACY_SESSION_ID,
        LEGACY_AGENT_ID,
        'Cache migration session',
        null,
        0,
        '2026-07-22T00:00:00.000Z',
        '2026-07-23T00:00:00.000Z'
      )

    const insertMessage = database.prepare(
      `INSERT INTO session_messages
        (id, session_id, role, content, agent_session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insertMessage.run(
      1,
      LEGACY_SESSION_ID,
      'user',
      JSON.stringify({ parts: [{ type: 'text', text: 'first Claude session' }] }),
      CLAUDE_SESSION_IDS[0],
      '2026-07-22T01:00:00.000Z',
      '2026-07-22T01:00:01.000Z'
    )
    insertMessage.run(
      2,
      LEGACY_SESSION_ID,
      'assistant',
      JSON.stringify({ parts: [{ type: 'text', text: 'same Claude session continues' }] }),
      CLAUDE_SESSION_IDS[0],
      '2026-07-22T01:01:00.000Z',
      '2026-07-22T01:01:01.000Z'
    )
    insertMessage.run(
      3,
      LEGACY_SESSION_ID,
      'user',
      JSON.stringify({ parts: [{ type: 'text', text: 'second Claude session' }] }),
      CLAUDE_SESSION_IDS[1],
      '2026-07-22T02:00:00.000Z',
      '2026-07-22T02:00:01.000Z'
    )
    insertMessage.run(
      4,
      LEGACY_SESSION_ID,
      'assistant',
      JSON.stringify({ parts: [{ type: 'text', text: 'message without a Claude session' }] }),
      '',
      '2026-07-22T03:00:00.000Z',
      '2026-07-22T03:00:01.000Z'
    )
  } finally {
    database.close()
  }
}

function setLegacyWorkspacePath(databasePath: string, workspacePath: string): void {
  const database = new Database(databasePath)
  try {
    const serializedPath = JSON.stringify([workspacePath])
    database.prepare('UPDATE agents SET accessible_paths = ?').run(serializedPath)
    database.prepare('UPDATE sessions SET accessible_paths = ?').run(serializedPath)
  } finally {
    database.close()
  }
}

function oldMachineDefaultWorkspacePath(databasePath: string): string {
  return path.join(
    path.dirname(path.dirname(databasePath)),
    'old-user-data',
    'Data',
    'Agents',
    LEGACY_AGENT_ID.slice(-9)
  )
}

async function createMigrationFixture(tempRoots: string[]) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-migrator-session-cache-'))
  tempRoots.push(tempRoot)
  const legacyAgentDbFile = path.join(tempRoot, 'Data', 'agents.db')
  const agentsDataDir = path.join(tempRoot, 'Data', 'Agents')
  const legacyClaudeConfigDir = path.join(tempRoot, '.claude')
  const legacyClaudeProjectsDir = path.join(legacyClaudeConfigDir, 'projects')
  const claudeConfigDir = path.join(agentsDataDir, '.claude')
  const claudeProjectsDir = path.join(claudeConfigDir, 'projects')
  const agentSystemWorkspacesDir = path.join(agentsDataDir, 'system')
  const legacyWorkspace = legacyAgentWorkspacePath(agentsDataDir, LEGACY_AGENT_ID)

  await mkdir(path.dirname(legacyAgentDbFile), { recursive: true })
  await mkdir(legacyWorkspace, { recursive: true })
  const legacyProjectDirectory = path.join(
    legacyClaudeProjectsDir,
    claudeProjectDirectoryName(await realpath(legacyWorkspace))
  )
  await mkdir(legacyProjectDirectory, { recursive: true })
  seedLegacyAgentsDb(legacyAgentDbFile)
  await writeFile(path.join(legacyWorkspace, 'workspace.txt'), 'legacy workspace')

  return {
    legacyAgentDbFile,
    legacyProjectDirectory,
    legacyWorkspace,
    claudeProjectsDir,
    agentSystemWorkspacesDir,
    context: {
      sharedData: new Map(),
      paths: {
        legacyAgentDbFile,
        legacyClaudeConfigDir,
        legacyClaudeProjectsDir,
        claudeConfigDir,
        claudeProjectsDir,
        agentsDataDir,
        agentSystemWorkspacesDir,
        filesDataDir: path.join(tempRoot, 'Data', 'Files')
      }
    }
  }
}

describe('AgentsMigrator Claude session cache integration', () => {
  const dbh = setupTestDatabase()
  const tempRoots: string[] = []

  afterEach(async () => {
    vi.useRealTimers()
    dbh.sqlite.pragma('foreign_keys = ON')
    await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
  })

  it('migrates every valid Claude session when a later message has an empty resume token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-30T00:00:00.000Z')
    const { legacyAgentDbFile, legacyProjectDirectory, claudeProjectsDir, agentSystemWorkspacesDir, context } =
      await createMigrationFixture(tempRoots)
    const legacyDatabase = new Database(legacyAgentDbFile)
    legacyDatabase
      .prepare(
        `INSERT INTO sessions
          (id, agent_id, name, accessible_paths, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'session_cache_old',
        LEGACY_AGENT_ID,
        'Old empty session',
        null,
        1,
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z'
      )
    legacyDatabase.close()
    await writeFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`), '{"session":"first"}\n')
    await writeFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[1]}.jsonl`), '{"session":"second"}\n')

    const migrationContext = {
      ...context,
      db: dbh.db
    } as unknown as MigrationContext

    // MigrationDbService disables foreign keys for the migration connection;
    // reproduce that production contract while AgentsMigrator remaps prefix IDs.
    dbh.sqlite.pragma('foreign_keys = OFF')
    await new AgentsMigrator().execute(migrationContext)

    const [agent] = await dbh.db.select().from(agentTable)
    const sessions = await dbh.db.select().from(agentSessionTable)
    const session = sessions.find((candidate) => candidate.name === 'Cache migration session')!
    const oldSession = sessions.find((candidate) => candidate.name === 'Old empty session')!
    const [workspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
    const messages = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, session.id))

    expect(agent.id).not.toBe(LEGACY_AGENT_ID)
    expect(session.id).not.toBe(LEGACY_SESSION_ID)
    expect(session.agentId).toBe(agent.id)
    expect(workspace.type).toBe('system')
    expect(workspace.path).toBe(path.join(agentSystemWorkspacesDir, '2026-07-22', session.id))
    expect(messages.map((message) => message.runtimeResumeToken).sort()).toEqual(
      [CLAUDE_SESSION_IDS[0], CLAUDE_SESSION_IDS[0], CLAUDE_SESSION_IDS[1], ''].sort()
    )
    const [oldWorkspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, oldSession.workspaceId))
    expect(await readFile(path.join(oldWorkspace.path, 'workspace.txt'), 'utf8')).toBe('legacy workspace')

    const migratedProjectDirectory = path.join(
      claudeProjectsDir,
      claudeProjectDirectoryName(await realpath(workspace.path))
    )
    expect(await readFile(path.join(migratedProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`), 'utf8')).toBe(
      '{"session":"first"}\n'
    )
    expect(await readFile(path.join(migratedProjectDirectory, `${CLAUDE_SESSION_IDS[1]}.jsonl`), 'utf8')).toBe(
      '{"session":"second"}\n'
    )
    await expect(access(path.join(migratedProjectDirectory, CLAUDE_SESSION_IDS[1]))).rejects.toThrow()
    expect(await readFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`), 'utf8')).toBe(
      '{"session":"first"}\n'
    )
    expect(await readFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[1]}.jsonl`), 'utf8')).toBe(
      '{"session":"second"}\n'
    )
  })

  it('preserves workspace output and resume tokens when the latest Claude JSONL is missing', async () => {
    const { legacyProjectDirectory, claudeProjectsDir, context } = await createMigrationFixture(tempRoots)
    await writeFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`), '{"session":"first"}\n')

    const migrationContext = {
      ...context,
      db: dbh.db
    } as unknown as MigrationContext

    dbh.sqlite.pragma('foreign_keys = OFF')
    await new AgentsMigrator().execute(migrationContext)

    const [session] = await dbh.db.select().from(agentSessionTable)
    const [workspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
    const messages = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, session.id))

    expect(messages.map((message) => message.runtimeResumeToken)).toEqual([
      CLAUDE_SESSION_IDS[0],
      CLAUDE_SESSION_IDS[0],
      CLAUDE_SESSION_IDS[1],
      ''
    ])
    expect(await readFile(path.join(workspace.path, 'workspace.txt'), 'utf8')).toBe('legacy workspace')

    const migratedProjectDirectory = path.join(
      claudeProjectsDir,
      claudeProjectDirectoryName(await realpath(workspace.path))
    )
    await expect(access(path.join(migratedProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`))).rejects.toThrow()
    await expect(access(path.join(migratedProjectDirectory, `${CLAUDE_SESSION_IDS[1]}.jsonl`))).rejects.toThrow()
    expect(await readFile(path.join(legacyProjectDirectory, `${CLAUDE_SESSION_IDS[0]}.jsonl`), 'utf8')).toBe(
      '{"session":"first"}\n'
    )
  })

  it('relocates a restored v1 default workspace whose persisted user-data root changed', async () => {
    const { legacyAgentDbFile, legacyWorkspace, agentSystemWorkspacesDir, context } =
      await createMigrationFixture(tempRoots)
    const oldWorkspace = oldMachineDefaultWorkspacePath(legacyAgentDbFile)
    setLegacyWorkspacePath(legacyAgentDbFile, oldWorkspace)

    const migrationContext = {
      ...context,
      db: dbh.db
    } as unknown as MigrationContext

    dbh.sqlite.pragma('foreign_keys = OFF')
    await new AgentsMigrator().execute(migrationContext)

    const [session] = await dbh.db.select().from(agentSessionTable)
    const [workspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))

    expect(workspace.type).toBe('system')
    expect(workspace.path).toBe(path.join(agentSystemWorkspacesDir, '2026-07-22', session.id))
    expect(await readFile(path.join(workspace.path, 'workspace.txt'), 'utf8')).toBe('legacy workspace')
    expect(await readFile(path.join(legacyWorkspace, 'workspace.txt'), 'utf8')).toBe('legacy workspace')
    await expect(access(oldWorkspace)).rejects.toThrow()
  })

  it('preserves an existing workspace with the v1 default path shape', async () => {
    const { legacyAgentDbFile, context } = await createMigrationFixture(tempRoots)
    const existingWorkspace = oldMachineDefaultWorkspacePath(legacyAgentDbFile)
    await mkdir(existingWorkspace, { recursive: true })
    await writeFile(path.join(existingWorkspace, 'external.txt'), 'external workspace')
    setLegacyWorkspacePath(legacyAgentDbFile, existingWorkspace)

    const migrationContext = {
      ...context,
      db: dbh.db
    } as unknown as MigrationContext

    dbh.sqlite.pragma('foreign_keys = OFF')
    await new AgentsMigrator().execute(migrationContext)

    const [session] = await dbh.db.select().from(agentSessionTable)
    const [workspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))

    expect(workspace.type).toBe('user')
    expect(workspace.path).toBe(existingWorkspace)
    expect(await readFile(path.join(existingWorkspace, 'external.txt'), 'utf8')).toBe('external workspace')
  })

  it('does not relocate a missing external workspace with a different path shape', async () => {
    const { legacyAgentDbFile, legacyWorkspace, context } = await createMigrationFixture(tempRoots)
    const externalWorkspace = path.join(
      path.dirname(path.dirname(legacyAgentDbFile)),
      'old-user-data',
      'projects',
      'agent-workspace'
    )
    setLegacyWorkspacePath(legacyAgentDbFile, externalWorkspace)

    const migrationContext = {
      ...context,
      db: dbh.db
    } as unknown as MigrationContext

    dbh.sqlite.pragma('foreign_keys = OFF')
    await new AgentsMigrator().execute(migrationContext)

    const [session] = await dbh.db.select().from(agentSessionTable)
    const [workspace] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))

    expect(workspace.type).toBe('user')
    expect(workspace.path).toBe(externalWorkspace)
    await expect(access(externalWorkspace)).rejects.toThrow()
    expect(await readFile(path.join(legacyWorkspace, 'workspace.txt'), 'utf8')).toBe('legacy workspace')
  })
})
