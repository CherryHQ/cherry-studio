import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { validate as isUuid } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

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
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id,
      agentId: 'a1',
      name: id,
      workspaceId,
      orderKey: 'a0'
    })
    insertedSessions.push(id)
  }

  async function importLegacyRows(rows: LegacyMessageRow[]): Promise<number> {
    await dbh.db.run(sql.raw("ATTACH DATABASE ':memory:' AS agents_legacy"))
    try {
      await dbh.db.run(
        sql.raw(`CREATE TABLE agents_legacy.session_messages (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agent_session_id TEXT,
          created_at TEXT,
          updated_at TEXT
        )`)
      )

      for (const row of rows) {
        await dbh.db.run(sql`
          INSERT INTO agents_legacy.session_messages
            (id, session_id, role, content, agent_session_id, created_at, updated_at)
          VALUES
            (
              ${row.id},
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
      schemaInfo.session_messages = {
        exists: true,
        columns: new Set(['id', 'session_id', 'role', 'content', 'agent_session_id', 'created_at', 'updated_at'])
      }

      return await importLegacySessionMessages(dbh.db, schemaInfo)
    } finally {
      await dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
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
})
