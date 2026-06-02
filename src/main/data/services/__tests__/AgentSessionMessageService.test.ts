import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_ID = 'session-1'
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'

describe('AgentSessionMessageService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    await dbh.db.insert(agentSessionTable).values({ id: SESSION_ID, name: 'Session', orderKey: 'a0' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates messages with service-owned audit timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const saved = await agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_000)
    expect(session.updatedAt).toBe(1_700_000_000_000)
    expect(saved.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(saved.updatedAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('keeps createdAt stable when updating an existing message', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_500)

    const created = await agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })
    const updated = await agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'edited' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_500)
    expect(session.updatedAt).toBe(1_700_000_000_500)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBe('2023-11-14T22:13:20.500Z')
  })

  it('uses one timestamp for a batch of newly saved messages', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_001_000)

    await agentSessionMessageService.saveMessages({
      sessionId: SESSION_ID,
      messages: [
        {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        },
        {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] }
        }
      ]
    })

    const rows = await dbh.db.select().from(agentSessionMessageTable)
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.createdAt)).toEqual([1_700_000_001_000, 1_700_000_001_000])
    expect(rows.map((row) => row.updatedAt)).toEqual([1_700_000_001_000, 1_700_000_001_000])
    expect(session.updatedAt).toBe(1_700_000_001_000)
  })

  it('keeps searchable_text and FTS index in sync from message data', async () => {
    await dbh.db.insert(agentSessionMessageTable).values({
      id: USER_MESSAGE_ID,
      sessionId: SESSION_ID,
      role: 'user',
      data: {
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'reasoning', text: 'thinking' }
        ]
      },
      status: 'success'
    })

    const [inserted] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    expect(inserted.searchableText).toBe('hello\nthinking')

    const thinkingMatches = await dbh.client.execute({
      sql: `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`,
      args: ['thinking']
    })
    expect(thinkingMatches.rows.map((row) => String(row[0]))).toEqual([USER_MESSAGE_ID])

    await dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'updated target' }] } })
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))

    const staleMatches = await dbh.client.execute({
      sql: `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`,
      args: ['thinking']
    })
    const targetMatches = await dbh.client.execute({
      sql: `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`,
      args: ['target']
    })

    expect(staleMatches.rows).toHaveLength(0)
    expect(targetMatches.rows.map((row) => String(row[0]))).toEqual([USER_MESSAGE_ID])
  })

  it('lists the first session message page anchored at a target message', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'target' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d012',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newest' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const result = await agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011',
      limit: 2
    })

    expect(result.items.map((item) => item.id)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
    ])
    expect(result.nextCursor).toBeUndefined()
  })

  it('searches session message parts text', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'agent-search',
      type: 'claude-code',
      name: 'Search Agent',
      instructions: 'Search instructions',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-search',
      agentId: 'agent-search',
      name: 'Session Search',
      orderKey: 's0',
      createdAt: 150,
      updatedAt: 150
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
      sessionId: 'session-search',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'The session message has a unique needle.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = await agentSessionMessageService.search({ q: 'needle' })

    expect(result.items).toEqual([
      expect.objectContaining({
        messageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
        sessionId: 'session-search',
        sessionName: 'Session Search',
        agentId: 'agent-search',
        agentName: 'Search Agent',
        role: 'assistant'
      })
    ])
    expect(result.items[0].snippet).toContain('unique needle')
  })

  it('matches extracted text instead of serialized JSON escapes', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-escaped',
      name: 'Session Escaped',
      orderKey: 'se0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102',
      sessionId: 'session-escaped',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'line one\nline two' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = await agentSessionMessageService.search({
      q: '"line one\nline two"'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102'])
  })

  it('defaults session message search to substring matching', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-substring-default',
      name: 'Session Substring Default',
      orderKey: 'ssd0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa',
      sessionId: 'session-substring-default',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'abcneedledef is embedded in a larger token.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = await agentSessionMessageService.search({ q: 'needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa'])
  })

  it('uses the session message FTS index as the search candidate source', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-fts-candidate',
      name: 'Session FTS Candidate',
      orderKey: 'sfc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab',
      sessionId: 'session-fts-candidate',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'needle exists in the base session message text.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const ftsRow = await dbh.client.execute({
      sql: 'SELECT rowid, searchable_text FROM agent_session_message WHERE id = ?',
      args: ['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab']
    })
    await dbh.client.execute({
      sql: `INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
            VALUES ('delete', ?, ?)`,
      args: [ftsRow.rows[0][0], ftsRow.rows[0][1]]
    })

    let result: Awaited<ReturnType<typeof agentSessionMessageService.search>>
    try {
      result = await agentSessionMessageService.search({ q: 'needle' })
    } finally {
      await dbh.client.execute(`INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')`)
    }

    expect(result.items).toEqual([])
  })

  it('filters session message search by session id', async () => {
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-source-filter',
        name: 'Session Source Filter',
        orderKey: 'sf0'
      },
      {
        id: 'session-source-other',
        name: 'Session Source Other',
        orderKey: 'sf1'
      }
    ])
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103',
        sessionId: 'session-source-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'session-only needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d104',
        sessionId: 'session-source-other',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other session needle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = await agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-source-filter'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103'])
  })

  it('filters session message search by createdAtFrom', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-created-filter',
      name: 'Session Created Filter',
      orderKey: 'sc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d108',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older session needle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 500
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer session needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const result = await agentSessionMessageService.search({
      q: 'needle',
      createdAtFrom: '1970-01-01T00:00:00.250Z'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109'])
  })

  it('paginates search with message ids as row-id cursors', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-page',
      name: 'Session Page',
      orderKey: 'sp0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle newest' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const firstPage = await agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2
    })
    const secondPage = await agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106'
    ])
    expect(firstPage.nextCursor).toBe('200:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105'])
    expect(secondPage.nextCursor).toBeUndefined()
  })
})
