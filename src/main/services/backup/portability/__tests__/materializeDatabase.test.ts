import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readAppliedChain } from '@data/db/restore/appliedChain'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { MESSAGE_FTS_STATEMENTS, messageTable } from '@data/db/schemas/message'
import { noteTable } from '@data/db/schemas/note'
import { preferenceTable } from '@data/db/schemas/preference'
import { topicTable } from '@data/db/schemas/topic'
import type { DbType } from '@data/db/types'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareManagedRootRebase } from '../managedPathRebase'
import {
  type MaterializeMode,
  materializePortableDatabase,
  summarizeMaterializationDegradations
} from '../materializeDatabase'

/**
 * Real-database proof for portable materialization (Phase 1c-ii). Every fixture
 * runs the production migrations through `setupTestDatabase()`, is exported with
 * the production `snapshotTo` (`VACUUM INTO`) primitive, and is then materialized
 * as a detached file exactly the way the export and restore pipelines will.
 */

const PRODUCER_NOTES = '/producer/Library/CherryStudio/Data/Notes'
const PRODUCER_WORKSPACES = '/producer/Library/CherryStudio/Data/agents/workspaces'
const TARGET_NOTES = '/target/home/cherry/Data/Notes'
const TARGET_WORKSPACES = '/target/home/cherry/Data/agents/workspaces'

function restoreMode(overrides?: { readonly notes?: string; readonly workspaces?: string }): MaterializeMode {
  const prepared = prepareManagedRootRebase({
    producerPlatform: 'linux',
    producerRoots: [
      { key: 'feature.notes.data', path: PRODUCER_NOTES },
      { key: 'feature.agents.workspaces', path: PRODUCER_WORKSPACES }
    ],
    targetPlatform: 'linux',
    targetRoots: {
      'feature.notes.data': overrides?.notes ?? TARGET_NOTES,
      'feature.agents.workspaces': overrides?.workspaces ?? TARGET_WORKSPACES
    }
  })
  if (!prepared.ok) throw new Error(`fixture rebase table invalid: ${prepared.error.code}`)
  return { kind: 'restore', rebase: prepared.table }
}

const EXPORT_MODE: MaterializeMode = { kind: 'export' }

describe('materializePortableDatabase', () => {
  const dbh = setupTestDatabase()
  let workDir: string
  let snapshotIndex = 0

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cs-materialize-'))
    snapshotIndex = 0
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  /** Export the harness database the way production does, returning the detached file. */
  function snapshot(): string {
    const target = join(workDir, `snapshot-${(snapshotIndex += 1)}.sqlite`)
    snapshotTo(dbh.sqlite, target)
    return target
  }

  /** Open a materialized file for assertions, without holding the handle open. */
  function inspect<T>(dbPath: string, read: (db: DbType, sqlite: Database.Database) => T): T {
    const sqlite = new Database(dbPath, { fileMustExist: true, readonly: true })
    try {
      return read(drizzle({ client: sqlite, casing: 'snake_case' }), sqlite)
    } finally {
      sqlite.close()
    }
  }

  function insertAgent(id: string, configuration: Record<string, unknown>): void {
    dbh.db
      .insert(agentTable)
      .values({ id, type: 'custom', name: id, instructions: 'do things', configuration, orderKey: id })
      .run()
  }

  function insertWorkspace(id: string, path: string, type: 'user' | 'system'): void {
    dbh.db.insert(agentWorkspaceTable).values({ id, name: id, path, type, orderKey: id }).run()
  }

  describe('runtime work', () => {
    it('deletes jobs that would execute on the target and keeps terminal history', async () => {
      const base = { type: 'test', queue: 'default', scheduledAt: 0, input: {} }
      dbh.db
        .insert(jobTable)
        .values([
          { ...base, id: 'j-pending', status: 'pending' },
          { ...base, id: 'j-delayed', status: 'delayed' },
          { ...base, id: 'j-running', status: 'running' },
          { ...base, id: 'j-completed', status: 'completed' },
          { ...base, id: 'j-failed', status: 'failed' },
          { ...base, id: 'j-cancelled', status: 'cancelled' }
        ])
        .run()
      // No unknown-status row here on purpose: SQLite's `integrity_check` also
      // verifies CHECK constraints, so a row violating `job_status_check` cannot
      // coexist with a database that passes the seal — it would be rejected as
      // `db-corrupt` at admission first. The reset still defends against an
      // unknown status because a crafted archive can ship a schema that never
      // declared the CHECK; that branch is covered by the pure predicate test
      // (`isJobRowResettable`), which is where it is actually reachable.

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.activeJobsDeleted).toBe(3)
      const surviving = inspect(dbPath, (db) => db.select({ id: jobTable.id }).from(jobTable).all())
      expect(surviving.map((row) => row.id).sort()).toEqual(['j-cancelled', 'j-completed', 'j-failed'])
    })

    it('disables every enabled schedule without touching its scheduling cursors', async () => {
      const base = {
        type: 'test',
        trigger: { kind: 'cron', expr: '* * * * *' },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      } as const
      dbh.db
        .insert(jobScheduleTable)
        .values([
          { ...base, id: 's-on', name: 'armed', enabled: true, nextRun: 111, lastRun: 222 },
          { ...base, id: 's-off', name: 'idle', enabled: false, nextRun: 333, lastRun: 444 }
        ])
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.schedulesDisabled).toBe(1)
      const rows = inspect(dbPath, (db) =>
        db
          .select({
            id: jobScheduleTable.id,
            enabled: jobScheduleTable.enabled,
            nextRun: jobScheduleTable.nextRun,
            lastRun: jobScheduleTable.lastRun
          })
          .from(jobScheduleTable)
          .all()
      )
      // `lastRun` must survive: clearing it would re-arm a spent `once` schedule.
      expect(rows).toEqual([
        { id: 's-on', enabled: false, nextRun: 111, lastRun: 222 },
        { id: 's-off', enabled: false, nextRun: 333, lastRun: 444 }
      ])
    })

    it('rewrites only the knowledge-item status that auto-executes a delete on boot', async () => {
      dbh.db
        .insert(knowledgeBaseTable)
        .values({ id: 'kb-1', name: 'kb', status: 'completed', chunkSize: 512, chunkOverlap: 32 })
        .run()
      const base = { baseId: 'kb-1', type: 'file' as const, data: { source: '/tmp/x' } as never }
      dbh.db
        .insert(knowledgeItemTable)
        .values([
          { ...base, id: 'k-deleting', status: 'deleting' },
          { ...base, id: 'k-processing', status: 'processing' },
          { ...base, id: 'k-completed', status: 'completed' }
        ])
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.knowledgeItemsReset).toBe(1)
      const rows = inspect(dbPath, (db) =>
        db
          .select({ id: knowledgeItemTable.id, status: knowledgeItemTable.status, error: knowledgeItemTable.error })
          .from(knowledgeItemTable)
          .all()
      )
      const byId = new Map(rows.map((row) => [row.id, row]))
      expect(byId.get('k-completed')).toEqual({ id: 'k-completed', status: 'completed', error: null })
      // The owner force-fails its own interrupted work on every startup, so this
      // is deliberately left alone rather than double-policed here.
      expect(byId.get('k-processing')).toEqual({ id: 'k-processing', status: 'processing', error: null })
      // `knowledge_item_status_error_check` admits `failed` only with a non-blank
      // error, so the status can never be written on its own.
      expect(byId.get('k-deleting')?.status).toBe('failed')
      expect((byId.get('k-deleting')?.error ?? '').trim().length).toBeGreaterThan(0)
    })
  })

  describe('executable and network capabilities', () => {
    it('disarms an MCP server while preserving its configuration as inert data', async () => {
      dbh.db
        .insert(mcpServerTable)
        .values({
          id: 'mcp-1',
          name: 'local tools',
          type: 'stdio',
          command: '/producer/bin/tool',
          args: ['--serve'],
          env: { TOKEN: 'secret' },
          baseUrl: 'https://mcp.example.com',
          headers: { Authorization: 'Bearer x' },
          disabledTools: ['rm'],
          dxtPath: '/producer/dxt/pkg',
          isActive: true,
          isTrusted: true,
          trustedAt: 1234
        })
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.mcpServersSanitized).toBe(1)
      expect(result.summary.degradations).toEqual([])
      const [row] = inspect(dbPath, (db) => db.select().from(mcpServerTable).all())
      expect({
        isActive: row.isActive,
        isTrusted: row.isTrusted,
        trustedAt: row.trustedAt,
        dxtPath: row.dxtPath
      }).toEqual({ isActive: false, isTrusted: null, trustedAt: null, dxtPath: null })
      // Configuration survives so the user can re-enable it without retyping.
      expect({
        command: row.command,
        args: row.args,
        env: row.env,
        baseUrl: row.baseUrl,
        headers: row.headers
      }).toEqual({
        command: '/producer/bin/tool',
        args: ['--serve'],
        env: { TOKEN: 'secret' },
        baseUrl: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer x' }
      })
      // A restriction is never widened.
      expect(row.disabledTools).toEqual(['rm'])
    })

    it('clears the whole executable capability when a known JSON field is unparseable', async () => {
      dbh.db
        .insert(mcpServerTable)
        .values({ id: 'mcp-bad', name: 'broken', command: '/producer/bin/tool', isActive: true })
        .run()
      // Stored text that drizzle's json mapper would throw on while reading.
      dbh.sqlite.prepare('UPDATE mcp_server SET env = ? WHERE id = ?').run('{not json', 'mcp-bad')

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.degradations).toEqual([
        { table: 'mcp_server', rowId: 'mcp-bad', reason: 'capability-malformed', detail: 'env' }
      ])
      const [row] = inspect(dbPath, (db) =>
        db.select({ command: mcpServerTable.command, isActive: mcpServerTable.isActive }).from(mcpServerTable).all()
      )
      expect(row).toEqual({ command: null, isActive: false })
    })

    it('disarms agent automation while preserving instructions and unknown keys', async () => {
      insertAgent('agent-1', {
        heartbeat_enabled: true,
        permission_mode: 'bypassPermissions',
        env_vars: { HOME_OVERRIDE: '/producer/home' },
        future_key: 'keep me'
      })

      const dbPath = snapshot()
      await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      const [row] = inspect(dbPath, (db) =>
        db
          .select({ instructions: agentTable.instructions, configuration: agentTable.configuration })
          .from(agentTable)
          .all()
      )
      expect(row.configuration).toEqual({
        heartbeat_enabled: false,
        scheduler_enabled: false,
        env_vars: { HOME_OVERRIDE: '/producer/home' },
        future_key: 'keep me'
      })
      expect(row.instructions).toBe('do things')
    })

    it('deactivates a channel and clears its proactive push list while keeping its credentials', async () => {
      insertAgent('agent-2', {})
      dbh.db
        .insert(agentChannelTable)
        .values({
          id: 'ch-1',
          type: 'telegram',
          name: 'ops',
          agentId: 'agent-2',
          workspace: { type: 'system' } as never,
          config: { botToken: 'secret-token' },
          isActive: true,
          activeChatIds: ['chat-1', 'chat-2'],
          permissionMode: 'bypassPermissions'
        })
        .run()

      const dbPath = snapshot()
      await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      const [row] = inspect(dbPath, (db) => db.select().from(agentChannelTable).all())
      expect({ isActive: row.isActive, activeChatIds: row.activeChatIds, permissionMode: row.permissionMode }).toEqual({
        isActive: false,
        activeChatIds: [],
        permissionMode: null
      })
      expect(row.config).toEqual({ botToken: 'secret-token' })
    })

    it('re-disarms a hostile-but-self-consistent archive on the restore side', async () => {
      // An archive whose producer never sanitized: everything is armed.
      dbh.db
        .insert(mcpServerTable)
        .values({ id: 'mcp-h', name: 'armed', command: '/x', isActive: true, isTrusted: true, dxtPath: '/x/dxt' })
        .run()
      insertAgent('agent-h', { heartbeat_enabled: true })

      const dbPath = snapshot()
      await materializePortableDatabase({ dbPath, mode: restoreMode() })

      const state = inspect(dbPath, (db) => ({
        mcp: db
          .select({ isActive: mcpServerTable.isActive, dxtPath: mcpServerTable.dxtPath })
          .from(mcpServerTable)
          .all(),
        agent: db.select({ configuration: agentTable.configuration }).from(agentTable).all()
      }))
      expect(state.mcp).toEqual([{ isActive: false, dxtPath: null }])
      expect(state.agent[0].configuration).toMatchObject({ heartbeat_enabled: false })
    })
  })

  describe('preferences', () => {
    it('deletes device-bound keys and preserves ordinary user preferences', async () => {
      dbh.db
        .insert(preferenceTable)
        .values([
          { key: 'app.user.id', value: 'producer-client-id' },
          { key: 'feature.api_gateway.enabled', value: true },
          { key: 'feature.api_gateway.api_key', value: 'producer-secret' },
          { key: 'data.backup.webdav.auto_sync', value: true },
          { key: 'data.backup.webdav.host', value: 'https://dav.example.com' },
          { key: 'app.language', value: 'zh-CN' },
          { key: 'app.theme', value: 'dark' }
        ])
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.preferencesDeleted).toBe(4)
      const keys = inspect(dbPath, (db) => db.select({ key: preferenceTable.key }).from(preferenceTable).all())
      // The destination stays configured; only its automation is reset.
      expect(keys.map((row) => row.key).sort()).toEqual(['app.language', 'app.theme', 'data.backup.webdav.host'])
    })

    it('strips only the device-local fields from feature.code_cli.configs', async () => {
      dbh.db
        .insert(preferenceTable)
        .values({
          key: 'feature.code_cli.configs',
          value: {
            claude: {
              current: 'anthropic',
              providers: { anthropic: {} },
              directory: '/producer/work',
              terminal: 'iterm'
            },
            codex: { current: 'openai' }
          }
        })
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.codeCliConfigsRewritten).toBe(1)
      expect(result.summary.codeCliConfigsDeleted).toBe(0)
      const [row] = inspect(dbPath, (db) =>
        db
          .select({ value: preferenceTable.value })
          .from(preferenceTable)
          .where(eq(preferenceTable.key, 'feature.code_cli.configs'))
          .all()
      )
      expect(row.value).toEqual({
        claude: { current: 'anthropic', providers: { anthropic: {} } },
        codex: { current: 'openai' }
      })
    })

    it('drops feature.code_cli.configs when its stored value is unparseable', async () => {
      dbh.db.insert(preferenceTable).values({ key: 'feature.code_cli.configs', value: {} }).run()
      dbh.sqlite.prepare("UPDATE preference SET value = ? WHERE key = 'feature.code_cli.configs'").run('[not-a-map')

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.codeCliConfigsDeleted).toBe(1)
      const rows = inspect(dbPath, (db) => db.select({ key: preferenceTable.key }).from(preferenceTable).all())
      expect(rows).toEqual([])
    })
  })

  describe('managed-path rebasing', () => {
    it('rebases managed roots onto target roots and leaves external paths inert', async () => {
      dbh.db
        .insert(noteTable)
        .values([
          { id: 'n-managed', rootPath: PRODUCER_NOTES, path: 'inbox/today.md', isStarred: true },
          { id: 'n-external', rootPath: '/producer/Dropbox/Notes', path: 'shared.md', isStarred: true }
        ])
        .run()
      insertWorkspace('w-system', `${PRODUCER_WORKSPACES}/session-1`, 'system')
      insertWorkspace('w-user', '/producer/code/project', 'user')

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: restoreMode() })

      expect(result.summary.pathsRebased).toBe(2)
      expect(result.summary.pathsExternal).toBe(2)
      expect(result.summary.degradations).toEqual([])

      const state = inspect(dbPath, (db) => ({
        notes: db
          .select({ id: noteTable.id, rootPath: noteTable.rootPath, path: noteTable.path })
          .from(noteTable)
          .all(),
        workspaces: db
          .select({ id: agentWorkspaceTable.id, path: agentWorkspaceTable.path })
          .from(agentWorkspaceTable)
          .all()
      }))
      expect(state.notes.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        // `path` is root-relative and is never rewritten.
        { id: 'n-external', rootPath: '/producer/Dropbox/Notes', path: 'shared.md' },
        { id: 'n-managed', rootPath: TARGET_NOTES, path: 'inbox/today.md' }
      ])
      expect(state.workspaces.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: 'w-system', path: `${TARGET_WORKSPACES}/session-1` },
        { id: 'w-user', path: '/producer/code/project' }
      ])
    })

    it('is a no-op for a same-device restore', async () => {
      dbh.db.insert(noteTable).values({ id: 'n-1', rootPath: PRODUCER_NOTES, path: 'a.md', isStarred: true }).run()
      insertWorkspace('w-1', `${PRODUCER_WORKSPACES}/s1`, 'system')

      const dbPath = snapshot()
      const result = await materializePortableDatabase({
        dbPath,
        mode: restoreMode({ notes: PRODUCER_NOTES, workspaces: PRODUCER_WORKSPACES })
      })

      expect(result.summary.pathsRebased).toBe(0)
      const paths = inspect(dbPath, (db) =>
        db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()
      )
      expect(paths).toEqual([{ path: `${PRODUCER_WORKSPACES}/s1` }])
    })

    it('never rebases on the export side', async () => {
      insertWorkspace('w-1', `${PRODUCER_WORKSPACES}/s1`, 'system')

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(result.summary.pathsRebased).toBe(0)
      expect(result.summary.pathsExternal).toBe(0)
      const paths = inspect(dbPath, (db) =>
        db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()
      )
      expect(paths).toEqual([{ path: `${PRODUCER_WORKSPACES}/s1` }])
    })

    it('degrades an unportable managed suffix instead of rewriting it', async () => {
      // A crafted row whose suffix escapes its own root.
      dbh.db
        .insert(noteTable)
        .values({ id: 'n-bad', rootPath: `${PRODUCER_NOTES}/../../etc`, path: 'a.md', isStarred: true })
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: restoreMode() })

      expect(result.summary.pathsRebased).toBe(0)
      expect(result.summary.degradations).toEqual([
        { table: 'note', rowId: 'n-bad', reason: 'path-unportable', detail: 'unportable-suffix' }
      ])
      const rows = inspect(dbPath, (db) => db.select({ rootPath: noteTable.rootPath }).from(noteTable).all())
      expect(rows).toEqual([{ rootPath: `${PRODUCER_NOTES}/../../etc` }])
    })

    it('keeps a colliding workspace inert rather than cascading its sessions away', async () => {
      // Crafted archive: an external USER workspace already sits exactly where the
      // SYSTEM workspace would land on this target.
      insertWorkspace('w-a-system', `${PRODUCER_WORKSPACES}/session-1`, 'system')
      insertWorkspace('w-b-user', `${TARGET_WORKSPACES}/session-1`, 'user')
      insertAgent('agent-1', {})
      dbh.db
        .insert(agentSessionTable)
        .values({
          id: 'sess-1',
          agentId: 'agent-1',
          workspaceId: 'w-a-system',
          name: 'keep me',
          orderKey: 'sess-1'
        } as never)
        .run()

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: restoreMode() })

      expect(result.summary.pathsRebased).toBe(0)
      expect(result.summary.degradations).toEqual([
        { table: 'agent_workspace', rowId: 'w-a-system', reason: 'path-collision', detail: undefined }
      ])
      const state = inspect(dbPath, (db) => ({
        workspaces: db
          .select({ id: agentWorkspaceTable.id, path: agentWorkspaceTable.path })
          .from(agentWorkspaceTable)
          .all(),
        sessions: db.select({ id: agentSessionTable.id }).from(agentSessionTable).all()
      }))
      // Both rows survive with distinct paths; the session is untouched.
      expect(state.workspaces.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: 'w-a-system', path: `${PRODUCER_WORKSPACES}/session-1` },
        { id: 'w-b-user', path: `${TARGET_WORKSPACES}/session-1` }
      ])
      expect(state.sessions).toEqual([{ id: 'sess-1' }])
    })
  })

  describe('bootstrap state and derived indexes', () => {
    it('preserves the migration chain, seed journal, and app_state', async () => {
      dbh.db
        .insert(appStateTable)
        .values([
          { key: 'migration_v2_status', value: { state: 'completed' } },
          { key: 'seedRunner:bootstrapCompleted', value: true },
          { key: 'seed:cherryAssistant', value: { version: '1' } }
        ])
        .run()
      const chainBefore = readAppliedChain(dbh.sqlite)

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: restoreMode() })

      expect(result.chain).toEqual(chainBefore)
      const keys = inspect(dbPath, (db) => db.select({ key: appStateTable.key }).from(appStateTable).all())
      expect(keys.map((row) => row.key).sort()).toEqual([
        'migration_v2_status',
        'seed:cherryAssistant',
        'seedRunner:bootstrapCompleted'
      ])
    })

    it('carries the transported FTS index across snapshot and materialization', async () => {
      dbh.db
        .insert(topicTable)
        .values({ id: 't-1', name: 'chat', orderKey: 't-1' } as never)
        .run()
      // `message_root_parent_check` couples role and parentId: the virtual root is
      // the only row allowed a null parent.
      dbh.db
        .insert(messageTable)
        .values([
          { id: 'm-root', topicId: 't-1', role: 'root', status: 'success', data: { parts: [] } },
          {
            id: 'm-1',
            topicId: 't-1',
            parentId: 'm-root',
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'sphinx of quartz' }] }
          }
        ] as never)
        .run()

      const dbPath = snapshot()
      await materializePortableDatabase({ dbPath, mode: restoreMode() })

      const hits = inspect(
        dbPath,
        (_db, sqlite) =>
          sqlite
            .prepare(
              'SELECT m.id FROM message m JOIN message_fts fts ON m.fts_rowid = fts.rowid WHERE message_fts MATCH ?'
            )
            .all('sphinx') as Array<{ id: string }>
      )
      expect(hits.map((row) => row.id)).toEqual(['m-1'])
      // The index is external-content keyed on a stable fts_rowid, so transport is
      // sound; the statements exist only so a future rebuild can re-assert them.
      expect(MESSAGE_FTS_STATEMENTS.length).toBeGreaterThan(0)
    })

    it('leaves updated_at untouched so the artifact is a reproducible function of its input', async () => {
      insertAgent('agent-1', { heartbeat_enabled: true })
      insertWorkspace('w-1', `${PRODUCER_WORKSPACES}/s1`, 'system')
      const before = dbh.db.select({ id: agentTable.id, updatedAt: agentTable.updatedAt }).from(agentTable).all()

      const litePath = snapshot()
      const fullPath = join(workDir, 'full.sqlite')
      copyFileSync(litePath, fullPath)

      const lite = await materializePortableDatabase({ dbPath: litePath, mode: restoreMode() })
      const full = await materializePortableDatabase({ dbPath: fullPath, mode: restoreMode() })

      // Lite and Full differ only in resource payloads, so the same source
      // snapshot must yield a byte-identical database for both.
      expect(lite.hash).toBe(full.hash)
      expect(lite.sizeBytes).toBe(full.sizeBytes)
      expect(readFileSync(litePath).equals(readFileSync(fullPath))).toBe(true)
      const after = inspect(litePath, (db) =>
        db.select({ id: agentTable.id, updatedAt: agentTable.updatedAt }).from(agentTable).all()
      )
      expect(after).toEqual(before)
    })
  })

  describe('sealing and failure containment', () => {
    it('seals the artifact with no sidecars and reports its hash and size', async () => {
      insertAgent('agent-1', {})

      const dbPath = snapshot()
      const result = await materializePortableDatabase({ dbPath, mode: EXPORT_MODE })

      expect(existsSync(`${dbPath}-wal`)).toBe(false)
      expect(existsSync(`${dbPath}-shm`)).toBe(false)
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(result.sizeBytes).toBe(readFileSync(dbPath).byteLength)
      const mode = inspect(dbPath, (_db, sqlite) => String(sqlite.pragma('journal_mode', { simple: true })))
      expect(mode).toBe('delete')
    })

    it('rolls the whole detached database back when the policy fails part-way', async () => {
      dbh.db
        .insert(jobTable)
        .values({ id: 'j-pending', type: 'test', status: 'pending', queue: 'default', scheduledAt: 0, input: {} })
        .run()
      insertAgent('agent-1', { heartbeat_enabled: true })

      const dbPath = snapshot()
      const capabilityReset = await import('../capabilityReset')
      // Fail AFTER the job delete has already been issued inside the transaction.
      vi.spyOn(capabilityReset, 'sanitizeAgentAutomation').mockImplementation(() => {
        throw new Error('injected policy failure')
      })

      await expect(materializePortableDatabase({ dbPath, mode: EXPORT_MODE })).rejects.toThrow(
        'injected policy failure'
      )

      const state = inspect(dbPath, (db) => ({
        jobs: db.select({ id: jobTable.id }).from(jobTable).all(),
        agents: db.select({ configuration: agentTable.configuration }).from(agentTable).all()
      }))
      expect(state.jobs).toEqual([{ id: 'j-pending' }])
      expect(state.agents[0].configuration).toEqual({ heartbeat_enabled: true })
    })

    it('refuses a missing detached database instead of creating one', async () => {
      const missing = join(workDir, 'absent.sqlite')
      await expect(materializePortableDatabase({ dbPath: missing, mode: EXPORT_MODE })).rejects.toThrow()
      expect(existsSync(missing)).toBe(false)
    })

    it('honours cancellation before opening the database', async () => {
      const dbPath = snapshot()
      const controller = new AbortController()
      controller.abort()
      await expect(
        materializePortableDatabase({ dbPath, mode: EXPORT_MODE, signal: controller.signal })
      ).rejects.toThrow(/cancel/i)
    })
  })
})

describe('summarizeMaterializationDegradations', () => {
  it('folds rows into one line per (table, reason) with a count', () => {
    const summary = summarizeMaterializationDegradations(
      [
        { table: 'note', rowId: 'n-1', reason: 'path-unportable' },
        { table: 'note', rowId: 'n-2', reason: 'path-unportable' },
        { table: 'note', rowId: 'n-3', reason: 'path-collision' },
        { table: 'agent', rowId: 'a-1', reason: 'capability-malformed' }
      ],
      'portable-db'
    )

    expect(summary).toEqual([
      { kind: 'portable-db:note', reason: 'path-unportable (2 rows)' },
      { kind: 'portable-db:note', reason: 'path-collision (1 row)' },
      { kind: 'portable-db:agent', reason: 'capability-malformed (1 row)' }
    ])
  })

  it('never leaks a row id or a stored value', () => {
    // §5.1.1: the detail is structural, and even that stays out of the report —
    // these lines travel in a manifest an archive carries and in a journal on
    // disk, neither of which is a place for profile content.
    const summary = summarizeMaterializationDegradations(
      [{ table: 'mcp_server', rowId: 'secret-id', reason: 'capability-malformed', detail: 'args' }],
      'restore-db'
    )

    expect(JSON.stringify(summary)).not.toContain('secret-id')
    expect(JSON.stringify(summary)).not.toContain('args')
  })

  it('names the device the reduction happened on', () => {
    // A user reading "this came back reduced" must be able to tell whether the
    // archive never carried it or whether THIS device could not take it.
    const degradation = { table: 'note', rowId: 'n-1', reason: 'path-unportable' } as const

    expect(summarizeMaterializationDegradations([degradation], 'portable-db')[0].kind).toBe('portable-db:note')
    expect(summarizeMaterializationDegradations([degradation], 'restore-db')[0].kind).toBe('restore-db:note')
  })

  it('reports nothing when nothing was reduced', () => {
    expect(summarizeMaterializationDegradations([], 'restore-db')).toEqual([])
  })
})
