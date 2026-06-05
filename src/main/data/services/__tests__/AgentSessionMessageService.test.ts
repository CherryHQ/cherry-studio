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

  describe('findPendingAssistantMessageIds + markMessagesError (boot reconcile)', () => {
    it('finds only pending assistant rows and resolves them to error', async () => {
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
      const DONE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'
      const PENDING_USER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d012'
      await agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      await agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: DONE, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'done' }] } }
      })
      await agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING_USER, role: 'user', status: 'pending', data: { parts: [{ type: 'text', text: 'q' }] } }
      })

      expect(await agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([PENDING])

      await agentSessionMessageService.markMessagesError([PENDING])
      expect(await agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([])
      const [row] = await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, PENDING))
      expect(row.status).toBe('error')
    })
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
})
