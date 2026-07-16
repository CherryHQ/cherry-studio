import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionRuntimeStateTable } from '@data/db/schemas/agentSessionRuntimeState'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionRuntimeStateService } from '@data/services/AgentSessionRuntimeStateService'
import { toModelMessages } from '@main/ai/messages/messageRules'
import type { MessageData } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_ID = 'session-1'
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'
type AgentSessionInsert = typeof agentSessionTable.$inferInsert

describe('AgentSessionMessageService', () => {
  const dbh = setupTestDatabase()

  async function seedSession(values: Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }) {
    const workspaceId = values.workspaceId ?? `workspace-${values.id}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: `workspace-${values.orderKey}`
    })
    await dbh.db.insert(agentSessionTable).values({ ...values, workspaceId })
  }

  async function seedSessions(rows: Array<Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }>) {
    for (const row of rows) {
      await seedSession(row)
    }
  }

  beforeEach(async () => {
    await seedSession({ id: SESSION_ID, name: 'Session', orderKey: 'a0' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('findPendingAssistantMessageIds + markMessagesError (boot reconcile)', () => {
    it('finds only pending assistant rows and resolves them to error', async () => {
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
      const DONE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'
      const PENDING_USER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d012'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: DONE, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'done' }] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING_USER, role: 'user', status: 'pending', data: { parts: [{ type: 'text', text: 'q' }] } }
      })

      expect(agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([PENDING])

      agentSessionMessageService.markMessagesError([PENDING])
      expect(agentSessionMessageService.findPendingAssistantMessageIds()).toEqual([])
      const [row] = await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, PENDING))
      expect(row.status).toBe('error')
    })
  })

  it('creates messages with service-owned audit timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const saved = agentSessionMessageService.saveMessage({
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

    const created = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })
    const updated = agentSessionMessageService.saveMessage({
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

    agentSessionMessageService.saveMessages({
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

  it('falls back to the newest page when list pagination receives a malformed cursor', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: USER_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      cursor: 'not-a-cursor',
      limit: 1
    })

    expect(result.items.map((item) => item.id)).toEqual([ASSISTANT_MESSAGE_ID])
    expect(result.nextCursor).toBe(`200:${ASSISTANT_MESSAGE_ID}`)
  })

  it('anchors list pagination at messageId and continues older pages with cursor', async () => {
    const older = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d301'
    const middle = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d302'
    const target = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d303'
    const newer = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d304'
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: older,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: middle,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: target,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'target' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: newer,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 400,
        updatedAt: 400
      }
    ])

    const firstPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      limit: 2
    })
    const secondPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.items.map((item) => item.id)).toEqual([target, middle])
    expect(firstPage.nextCursor).toBe(`200:${middle}`)
    expect(secondPage.items.map((item) => item.id)).toEqual([older])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('falls back to the newest page when the anchor messageId is outside the requested session', async () => {
    const otherSessionId = 'session-other'
    const otherMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d305'
    const newestMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d306'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'b0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: otherMessageId,
        sessionId: otherSessionId,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: newestMessageId,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newest' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: otherMessageId
    })

    expect(result.items.map((item) => item.id)).toEqual([newestMessageId])
    expect(result.nextCursor).toBeUndefined()
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

    const thinkingMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    expect(thinkingMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])

    await dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'updated target' }] } })
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))

    const staleMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    const targetMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('target') as Array<{ id: string }>

    expect(staleMatches).toHaveLength(0)
    expect(targetMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])
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
    await seedSession({
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

    const result = agentSessionMessageService.search({ q: 'needle' })

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
    await seedSession({
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

    const result = agentSessionMessageService.search({
      q: '"line one\nline two"'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102'])
  })

  it('defaults session message search to substring matching', async () => {
    await seedSession({
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

    const result = agentSessionMessageService.search({ q: 'needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa'])
  })

  it('requires all search terms to match a session message', async () => {
    await seedSession({
      id: 'session-search-and',
      name: 'Session Search And',
      orderKey: 'ssa0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'alpha needle appear together.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bb',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle appears without the other term.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.search({ q: 'alpha needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba'])
  })

  it('treats LIKE wildcards as literal session-message search text after FTS prefiltering', async () => {
    await seedSession({
      id: 'session-search-literal',
      name: 'Session Search Literal',
      orderKey: 'ssl0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50% off today.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bd',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50X off today.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50_ off today.' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const percentResult = agentSessionMessageService.search({ q: '50%' })
    const underscoreResult = agentSessionMessageService.search({ q: '50_' })

    expect(percentResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc'])
    expect(underscoreResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be'])
  })

  it('uses the session message FTS index as the search candidate source', async () => {
    await seedSession({
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

    const ftsRow = dbh.sqlite
      .prepare('SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = ?')
      .get('018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab') as { fts_rowid: number; searchable_text: string }
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
            VALUES ('delete', ?, ?)`
      )
      .run(ftsRow.fts_rowid, ftsRow.searchable_text)

    let result: Awaited<ReturnType<typeof agentSessionMessageService.search>>
    try {
      result = agentSessionMessageService.search({ q: 'needle' })
    } finally {
      dbh.sqlite.prepare(`INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')`).run()
    }

    expect(result.items).toEqual([])
  })

  it('filters session message search by session id', async () => {
    await seedSessions([
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

    const result = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-source-filter'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103'])
  })

  it('filters session message search by createdAtFrom', async () => {
    await seedSession({
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

    const result = agentSessionMessageService.search({
      q: 'needle',
      createdAtFrom: '1970-01-01T00:00:00.250Z'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109'])
  })

  it('paginates search with message ids as row-id cursors', async () => {
    await seedSession({
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

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
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

  it('uses session message id as the search cursor tiebreaker when createdAt values match', async () => {
    await seedSession({
      id: 'session-page-tie',
      name: 'Session Page Tie',
      orderKey: 'spt0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie middle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie newest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206'
    ])
    expect(firstPage.nextCursor).toBe('100:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('rejects malformed session message search cursors', () => {
    let malformedError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'not-a-cursor' })
    } catch (error) {
      malformedError = error
    }
    expect(malformedError).toMatchObject({ code: 'VALIDATION_ERROR' })

    let nonNumericKeyError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'abc:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206' })
    } catch (error) {
      nonNumericKeyError = error
    }
    expect(nonNumericKeyError).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  describe('listRuntimeHistory', () => {
    const OLDEST = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e210'
    const TIE_INCLUDED = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e220'
    const BOUNDARY = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e230'
    const TIE_EXCLUDED = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e240'
    const QUEUED_FOLLOW_UP = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1e250'

    type SeedRow = {
      id: string
      createdAt: number
      role?: 'user' | 'assistant' | 'system'
      status?: 'pending' | 'success' | 'error' | 'paused'
      parts?: MessageData['parts']
      sessionId?: string
    }

    async function seedRows(rows: SeedRow[]) {
      await dbh.db.insert(agentSessionMessageTable).values(
        rows.map((row) => ({
          id: row.id,
          sessionId: row.sessionId ?? SESSION_ID,
          role: row.role ?? 'assistant',
          data: { parts: row.parts ?? [{ type: 'text' as const, text: row.id }] },
          status: row.status ?? 'success',
          createdAt: row.createdAt,
          updatedAt: row.createdAt
        }))
      )
    }

    it('returns rows ascending by (createdAt, id), strictly before the boundary tuple', async () => {
      await seedRows([
        // Insert out of order to prove ordering comes from the query, not insertion.
        { id: QUEUED_FOLLOW_UP, createdAt: 300, role: 'user' },
        { id: TIE_EXCLUDED, createdAt: 200 },
        { id: BOUNDARY, createdAt: 200, role: 'user' },
        { id: TIE_INCLUDED, createdAt: 200 },
        { id: OLDEST, createdAt: 100, role: 'user' }
      ])

      const items = agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: BOUNDARY })

      // Same-createdAt rows split on the id tiebreak; the boundary itself and the
      // later queued follow-up never leak into the current turn's replay.
      expect(items.map((item) => item.id)).toEqual([OLDEST, TIE_INCLUDED])

      // The runtime driver appends the incoming user row after this query: the
      // current prompt then appears exactly once and the queued follow-up not at all.
      const replay = [...items.map((item) => item.id), BOUNDARY]
      expect(replay.filter((id) => id === BOUNDARY)).toHaveLength(1)
      expect(replay).not.toContain(QUEUED_FOLLOW_UP)
    })

    it('excludes pending rows and keeps paused and error rows', async () => {
      await seedRows([
        { id: OLDEST, createdAt: 100, status: 'error' },
        { id: TIE_INCLUDED, createdAt: 150, status: 'paused' },
        { id: TIE_EXCLUDED, createdAt: 200, status: 'pending' },
        { id: BOUNDARY, createdAt: 300, role: 'user' }
      ])

      const items = agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: BOUNDARY })

      expect(items.map((item) => item.id)).toEqual([OLDEST, TIE_INCLUDED])
    })

    it('never returns rows from another session', async () => {
      await seedSession({ id: 'session-other', name: 'Other', orderKey: 'z0' })
      await seedRows([
        { id: OLDEST, createdAt: 100 },
        { id: TIE_EXCLUDED, createdAt: 100, sessionId: 'session-other' },
        { id: BOUNDARY, createdAt: 200, role: 'user' }
      ])

      const items = agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: BOUNDARY })

      expect(items.map((item) => item.id)).toEqual([OLDEST])
    })

    it('throws notFound when the boundary row is missing from the session', async () => {
      await seedSession({ id: 'session-other', name: 'Other', orderKey: 'z0' })
      await seedRows([{ id: TIE_EXCLUDED, createdAt: 100, sessionId: 'session-other' }])

      expect(() =>
        agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: BOUNDARY })
      ).toThrowError()
      // A boundary row in a different session is equally invalid.
      expect(() =>
        agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: TIE_EXCLUDED })
      ).toThrowError()
    })

    it('invalidates runtime compaction state in the same transaction as a message delete', async () => {
      await seedRows([
        { id: OLDEST, createdAt: 100 },
        { id: TIE_INCLUDED, createdAt: 200 }
      ])
      agentSessionRuntimeStateService.saveState({
        sessionId: SESSION_ID,
        runtimeType: 'ai-sdk',
        compactedThroughMessageId: OLDEST,
        summary: 'summary',
        compactionModelId: 'provider::model'
      })

      // Deleting a non-anchor row: only the service-level invalidation (not the
      // anchor FK cascade) can clear the state.
      agentSessionMessageService.deleteSessionMessage(SESSION_ID, TIE_INCLUDED)

      expect(await dbh.db.select().from(agentSessionRuntimeStateTable)).toHaveLength(0)
      expect(agentSessionRuntimeStateService.getState(SESSION_ID, 'ai-sdk')).toBeNull()
    })

    it('replays completed tool effects from a failed turn while conversion strips the dangling tail', async () => {
      await seedRows([
        { id: OLDEST, createdAt: 100, role: 'user', parts: [{ type: 'text', text: 'Q' }] },
        {
          id: TIE_INCLUDED,
          createdAt: 200,
          status: 'error',
          parts: [
            { type: 'text', text: 'wrote file' },
            {
              type: 'tool-write',
              toolCallId: 'call-done',
              state: 'output-available',
              input: { path: 'a.txt' },
              output: { ok: true }
            },
            { type: 'tool-write', toolCallId: 'call-dangling', state: 'input-available', input: { path: 'b.txt' } }
          ]
        },
        { id: BOUNDARY, createdAt: 300, role: 'user' }
      ])

      const items = agentSessionMessageService.listRuntimeHistory(SESSION_ID, { beforeMessageId: BOUNDARY })
      const model = await toModelMessages(
        items.map((item) => ({ id: item.id, role: item.role, parts: item.data.parts ?? [] }) as UIMessage)
      )

      expect(model[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Q' }] })
      expect(model[1]).toMatchObject({
        role: 'assistant',
        content: [
          { type: 'text', text: 'wrote file' },
          { type: 'tool-call', toolCallId: 'call-done', toolName: 'write', input: { path: 'a.txt' } }
        ]
      })
      expect(model[2]).toMatchObject({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-done', toolName: 'write' }]
      })
      expect(JSON.stringify(model)).not.toContain('call-dangling')
    })
  })
})
