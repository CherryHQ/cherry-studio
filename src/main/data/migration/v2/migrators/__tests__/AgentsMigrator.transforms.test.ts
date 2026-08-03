import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import {
  AGENT_SESSION_MESSAGE_INSERT_TRIGGER_NAME,
  agentSessionMessageTable
} from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { validate as isUuid } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importLegacySessionMessages } from '../AgentsMigrator'
import { createEmptyAgentsSchemaInfo } from '../mappings/AgentsDbMappings'

type LegacyMessageRow = {
  id: number
  sessionId: string
  role: string
  content: unknown
  agentSessionId?: string | null
  createdAt?: string
  updatedAt?: string
}

describe('importLegacySessionMessages', () => {
  const dbh = setupTestDatabase()
  const insertedSessions: string[] = []
  const sessionCreatedAt = Date.parse('2025-12-31T23:59:59.000Z')

  beforeEach(async () => {
    await dbh.db.delete(agentSessionMessageTable)
    // agent_session_message FK-cascades from agent_session; cleaning the
    // sessions inserted by previous cases keeps each test isolated without
    // needing to manage transactions.
    for (const sid of insertedSessions) {
      await dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sid))
    }
    insertedSessions.length = 0
    await dbh.db.delete(agentTable)
    await dbh.db.insert(agentTable).values({
      id: 'a1',
      type: 'claude_code',
      name: 'a1',
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
  })

  async function seedSession(id: string): Promise<void> {
    const workspaceId = `workspace-${id}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id,
      agentId: 'a1',
      name: id,
      workspaceId,
      orderKey: 'a0',
      lastActivityAt: sessionCreatedAt,
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt
    })
    insertedSessions.push(id)
  }

  async function importLegacyRows(rows: LegacyMessageRow[], options: { includeId?: boolean } = {}): Promise<number> {
    const includeId = options.includeId ?? true
    dbh.db.run(sql.raw("ATTACH DATABASE ':memory:' AS agents_legacy"))
    try {
      dbh.db.run(
        sql.raw(`CREATE TABLE agents_legacy.session_messages (
          ${includeId ? 'id INTEGER PRIMARY KEY,' : ''}
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agent_session_id TEXT,
          created_at TEXT,
          updated_at TEXT
        )`)
      )
      dbh.db.run(sql.raw('CREATE TABLE agents_legacy.agents (id TEXT PRIMARY KEY)'))
      dbh.db.run(
        sql.raw(
          'CREATE TABLE agents_legacy.sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id))'
        )
      )
      dbh.db.run(sql.raw("INSERT INTO agents_legacy.agents (id) VALUES ('a1')"))

      const idColumn = includeId ? sql.raw('id,') : sql.raw('')
      for (const row of rows) {
        dbh.db.run(sql`
          INSERT OR IGNORE INTO agents_legacy.sessions (id, agent_id)
          VALUES (${row.sessionId}, 'a1')
        `)
        const idValue = includeId ? sql`${row.id},` : sql.raw('')
        dbh.db.run(sql`
          INSERT INTO agents_legacy.session_messages
            (${idColumn} session_id, role, content, agent_session_id, created_at, updated_at)
          VALUES
            (
              ${idValue}
              ${row.sessionId},
              ${row.role},
              ${JSON.stringify(row.content)},
              ${row.agentSessionId ?? null},
              ${row.createdAt ?? '2026-01-01T00:00:00.000Z'},
              ${row.updatedAt ?? '2026-01-01T00:00:01.000Z'}
            )
        `)
      }

      const schemaInfo = createEmptyAgentsSchemaInfo()
      schemaInfo.agents = {
        exists: true,
        columns: new Set(['id'])
      }
      schemaInfo.sessions = {
        exists: true,
        columns: new Set(['id', 'agent_id'])
      }
      schemaInfo.session_messages = {
        exists: true,
        columns: new Set([
          ...(includeId ? ['id'] : []),
          'session_id',
          'role',
          'content',
          'agent_session_id',
          'created_at',
          'updated_at'
        ])
      }

      return await importLegacySessionMessages(dbh.db, schemaInfo)
    } finally {
      dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
    }
  }

  it('imports legacy integer message ids as UUID rows with direct data.parts', async () => {
    await seedSession('s-legacy')

    const imported = await importLegacyRows([
      {
        id: 1,
        sessionId: 's-legacy',
        role: 'assistant',
        agentSessionId: 'sdk-1',
        content: {
          message: {
            id: '1',
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'hello' }] }
          },
          blocks: []
        }
      }
    ])

    expect(imported).toBe(1)
    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-legacy'))
    expect(row.id).not.toBe('1')
    expect(isUuid(row.id)).toBe(true)
    expect(row.data).toEqual({ parts: [{ type: 'text', text: 'hello' }] })
    expect(JSON.stringify(row.data)).not.toContain('"message"')
    expect(row.runtimeResumeToken).toBe('sdk-1')
    expect(row.terminalAt).toBe(Date.parse('2026-01-01T00:00:01.000Z'))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 's-legacy'))
    expect(session.lastActivityAt).toBe(Date.parse('2026-01-01T00:00:01.000Z'))
    expect(session.updatedAt).toBe(sessionCreatedAt)
  })

  it('reads and imports legacy messages in bounded pages', async () => {
    await seedSession('s-paged')
    const allSpy = vi.spyOn(dbh.db, 'all')

    const imported = await importLegacyRows(
      Array.from({ length: 101 }, (_, index) => ({
        id: index + 1,
        sessionId: 's-paged',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: { parts: [{ type: 'text', text: `message ${index + 1}` }] },
        createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`
      }))
    )

    const sourcePageSizes = allSpy.mock.calls.flatMap(([statement], index) => {
      const query = (
        statement as unknown as {
          queryChunks: Array<{ value?: string[] }>
        }
      ).queryChunks[0]?.value?.[0]
      if (typeof query !== 'string' || !query.includes('agent_session_message_source_cursor AS cursor')) {
        return []
      }
      const result = allSpy.mock.results[index]
      if (!result || result.type !== 'return' || !Array.isArray(result.value)) {
        throw new Error('Expected a synchronous legacy session-message page')
      }
      return [result.value.length]
    })
    allSpy.mockRestore()

    expect(imported).toBe(101)
    expect(sourcePageSizes).toEqual([100, 1, 0])
    const [{ count }] = dbh.db
      .select({ count: sql<number>`count(*)` })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-paged'))
      .all()
    expect(count).toBe(101)
  })

  it('converts legacy block envelopes during import without a second pass', async () => {
    await seedSession('s-blocks')

    await importLegacyRows([
      {
        id: 2,
        sessionId: 's-blocks',
        role: 'assistant',
        content: {
          message: {
            id: '2',
            role: 'assistant',
            status: 'pending',
            blocks: ['b1']
          },
          blocks: [{ id: 'b1', type: 'main_text', content: 'hello world', createdAt: 0 }]
        }
      }
    ])

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-blocks'))
    expect(row.status).toBe('error')
    expect(row.searchableText).toBe('hello world')
    expect(row.data.parts?.[0]).toMatchObject({ type: 'text', text: 'hello world', state: 'done' })
    expect(JSON.stringify(row.data)).not.toContain('"blocks"')
    expect(JSON.stringify(row.data)).not.toContain('"message"')
  })

  it('uses the trigger searchable-text semantics for transformed legacy blocks', async () => {
    await seedSession('s-searchable-semantics')

    await importLegacyRows([
      {
        id: 20,
        sessionId: 's-searchable-semantics',
        role: 'assistant',
        content: {
          message: {
            id: '20',
            role: 'assistant',
            status: 'success'
          },
          blocks: [
            { id: 'text', type: 'main_text', content: 'visible phrase', createdAt: 0 },
            {
              id: 'translation',
              type: 'translation',
              content: 'translation needle',
              targetLanguage: 'zh-CN',
              createdAt: 0
            },
            { id: 'code', type: 'code', content: 'code needle', language: 'typescript', createdAt: 0 },
            {
              id: 'compact',
              type: 'compact',
              content: 'compact needle',
              compactedContent: 'compacted result',
              createdAt: 0
            }
          ]
        }
      }
    ])

    const [imported] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-searchable-semantics'))
    expect(imported.searchableText).toBe('visible phrase')

    await dbh.db
      .update(agentSessionMessageTable)
      .set({ data: imported.data })
      .where(eq(agentSessionMessageTable.id, imported.id))
    const [updated] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, imported.id))
    expect(updated.searchableText).toBe(imported.searchableText)

    const hiddenMatches = dbh.db.all<{ id: string }>(
      sql.raw(`SELECT agent_session_message.id
        FROM agent_session_message_fts
        INNER JOIN agent_session_message
          ON agent_session_message.fts_rowid = agent_session_message_fts.rowid
        WHERE agent_session_message_fts MATCH 'translation needle'`)
    )
    expect(hiddenMatches).toEqual([])
  })

  it('preserves legacy token usage as agent session message stats', async () => {
    await seedSession('s-stats')
    await dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'cherryin',
        name: 'CherryIN',
        orderKey: 'a0'
      })
      .onConflictDoNothing()
    await dbh.db
      .insert(userModelTable)
      .values({
        id: 'cherryin::anthropic/claude-sonnet-4.5',
        providerId: 'cherryin',
        modelId: 'anthropic/claude-sonnet-4.5',
        presetModelId: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0'
      })
      .onConflictDoNothing()

    await importLegacyRows([
      {
        id: 4,
        sessionId: 's-stats',
        role: 'assistant',
        content: {
          message: {
            id: '4',
            role: 'assistant',
            status: 'success',
            model: {
              id: 'anthropic/claude-sonnet-4.5',
              name: 'Claude Sonnet 4.5',
              provider: 'cherryin',
              group: 'anthropic'
            },
            modelId: 'anthropic/claude-sonnet-4.5',
            usage: {
              prompt_tokens: 8,
              completion_tokens: 13,
              total_tokens: 21,
              thoughts_tokens: 5,
              cost: 0.012
            },
            metrics: {
              time_first_token_millsec: 100,
              time_completion_millsec: 200,
              time_thinking_millsec: 50
            },
            data: { parts: [{ type: 'text', text: 'stats' }] }
          },
          blocks: []
        }
      }
    ])

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-stats'))
    expect(row.modelId).toBe('cherryin::anthropic/claude-sonnet-4.5')
    expect(row.stats).toEqual({
      inputTokens: 8,
      outputTokens: 13,
      totalTokens: 21,
      outputTokenDetails: { reasoningTokens: 5 },
      requestCount: 1,
      estimatedRequestCount: 1,
      unpricedRequestCount: 0,
      costs: [
        {
          currency: 'USD',
          amount: 0.012,
          providerReportedRequestCount: 1,
          computedRequestCount: 0
        }
      ],
      timeFirstTokenMs: 100,
      timeCompletionMs: 200,
      timeThinkingMs: 50
    })
  })

  it('keeps already-modern parts payloads during import', async () => {
    await seedSession('s-modern')

    await importLegacyRows([
      {
        id: 3,
        sessionId: 's-modern',
        role: 'user',
        content: {
          parts: [{ type: 'text', text: 'hi' }]
        }
      }
    ])

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-modern'))
    expect(row.role).toBe('user')
    expect(row.data).toEqual({ parts: [{ type: 'text', text: 'hi' }] })
    expect(row.searchableText).toBe('hi')
  })

  it('stages and imports large legacy sets in bounded pages, then rebuilds searchable FTS data', async () => {
    await seedSession('s-batched')
    const rows: LegacyMessageRow[] = Array.from({ length: 505 }, (_, index) => ({
      id: index + 1,
      sessionId: 's-batched',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: {
        parts: [{ type: 'text', text: index === 504 ? 'batch migration needle' : `message ${index}` }]
      }
    }))

    await expect(importLegacyRows(rows)).resolves.toBe(505)

    const importedRows = await dbh.db
      .select({
        ftsRowid: agentSessionMessageTable.ftsRowid,
        searchableText: agentSessionMessageTable.searchableText
      })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-batched'))
    expect(importedRows).toHaveLength(505)
    expect(new Set(importedRows.map((row) => row.ftsRowid)).size).toBe(505)
    expect(importedRows.every((row) => row.ftsRowid !== null)).toBe(true)

    const matches = dbh.db.all<{ searchableText: string }>(
      sql.raw(`SELECT agent_session_message.searchable_text AS searchableText
        FROM agent_session_message_fts
        INNER JOIN agent_session_message
          ON agent_session_message.fts_rowid = agent_session_message_fts.rowid
        WHERE agent_session_message_fts MATCH 'migration needle'`)
    )
    expect(matches).toEqual([{ searchableText: 'batch migration needle' }])
    expect(
      dbh.db.all<{ name: string }>(
        sql.raw(
          "SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = 'migration_agent_session_messages'"
        )
      )
    ).toEqual([])
  })

  it('uses SQLite rowid for bounded paging when the legacy id column is absent', async () => {
    await seedSession('s-rowid')
    const rows: LegacyMessageRow[] = Array.from({ length: 505 }, (_, index) => ({
      id: index + 1,
      sessionId: 's-rowid',
      role: 'assistant',
      content: { parts: [{ type: 'text', text: `rowid message ${index}` }] }
    }))

    await expect(importLegacyRows(rows, { includeId: false })).resolves.toBe(505)

    const importedRows = await dbh.db
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-rowid'))
    expect(importedRows).toHaveLength(505)
  })

  it('rolls back partial batches and restores the FTS insert trigger after an insert failure', async () => {
    await seedSession('s-rollback')
    dbh.db.run(
      sql.raw(`CREATE TRIGGER fail_agent_message_import BEFORE INSERT ON agent_session_message
        WHEN NEW.searchable_text = 'force rollback'
        BEGIN
          SELECT RAISE(ABORT, 'forced Agent message import failure');
        END`)
    )

    const rows: LegacyMessageRow[] = Array.from({ length: 101 }, (_, index) => ({
      id: index + 1,
      sessionId: 's-rollback',
      role: 'assistant',
      content: {
        parts: [{ type: 'text', text: index === 100 ? 'force rollback' : `message ${index}` }]
      }
    }))

    try {
      await expect(importLegacyRows(rows)).rejects.toThrow(/forced Agent message import failure/)
    } finally {
      dbh.db.run(sql.raw('DROP TRIGGER IF EXISTS fail_agent_message_import'))
    }

    const importedRows = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-rollback'))
    expect(importedRows).toHaveLength(0)
    const triggerRows = dbh.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master
          WHERE type = 'trigger' AND name = ${AGENT_SESSION_MESSAGE_INSERT_TRIGGER_NAME}`
    )
    expect(triggerRows).toEqual([{ name: AGENT_SESSION_MESSAGE_INSERT_TRIGGER_NAME }])
    expect(
      dbh.db.all<{ name: string }>(
        sql.raw(
          "SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = 'migration_agent_session_messages'"
        )
      )
    ).toEqual([])

    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-rollback',
      status: 'success',
      role: 'user',
      data: { parts: [{ type: 'text', text: 'trigger restored needle' }] } as never
    })
    const [inserted] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-rollback'))
    expect(inserted.searchableText).toBe('trigger restored needle')
    expect(inserted.ftsRowid).not.toBeNull()
  })
})
