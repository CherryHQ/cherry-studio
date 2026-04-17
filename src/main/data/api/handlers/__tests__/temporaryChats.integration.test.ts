/**
 * Integration test: full temporary-chat → persist → persistent-readback flow.
 *
 * Covers the UNIQUE end-to-end value that handler mock tests cannot: after
 * persist writes into the real DB, the persistent `messageService.getTree`
 * must read it back as a correctly-linearized tree with activeNodeId set to
 * the last message and FTS5 `searchable_text` auto-populated by triggers.
 *
 * Uses a file-backed libsql DB because `db.transaction()` releases its
 * connection (see pragmaReplay.test.ts) and `:memory:` DBs are per-connection
 * — persist's real transaction path cannot be exercised with in-memory libsql.
 */

import { MESSAGE_FTS_STATEMENTS } from '@data/db/schemas/message'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import type { PersistTemporaryChatResponse } from '@shared/data/api/schemas/temporaryChats'
import { BlockType, type Message, type MessageData } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Unmock fs/os/path so we can use real tmp dirs (tests/main.setup.ts mocks them).
vi.mock('node:fs', async (importOriginal) => await importOriginal())
vi.mock('node:os', async (importOriginal) => await importOriginal())
vi.mock('node:path', async (importOriginal) => await importOriginal())

const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

let realDb: DbType | null = null
let closeClient: (() => void) | undefined

vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => realDb)
    }))
  }
}))

// Dynamic import AFTER the mock so the services bind to the mocked application.
const { temporaryChatHandlers } = await import('../temporaryChats')
const { temporaryChatService } = await import('@data/services/TemporaryChatService')
const { messageService } = await import('@data/services/MessageService')

async function initializeSchema(db: DbType) {
  await db.run(
    sql.raw(`
      CREATE TABLE topic (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        is_name_manually_edited INTEGER DEFAULT 0,
        assistant_id TEXT,
        active_node_id TEXT,
        group_id TEXT,
        sort_order INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        pinned_order INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      )
    `)
  )
  await db.run(
    sql.raw(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT,
        topic_id TEXT NOT NULL,
        role TEXT NOT NULL,
        data TEXT NOT NULL,
        searchable_text TEXT,
        status TEXT NOT NULL,
        siblings_group_id INTEGER DEFAULT 0,
        model_id TEXT,
        model_snapshot TEXT,
        trace_id TEXT,
        stats TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      )
    `)
  )
  // FTS5 virtual table + triggers mirror production schema exactly.
  for (const stmt of MESSAGE_FTS_STATEMENTS) {
    await db.run(sql.raw(stmt))
  }
}

describe('Temporary Chat end-to-end (handler → persist → persistent readback)', () => {
  let tmpDir: string | undefined

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cherry-temp-chat-integ-'))
    const client = createClient({ url: `file:${join(tmpDir, 'test.db')}` })
    closeClient = () => client.close()
    realDb = drizzle({ client, casing: 'snake_case' })
    await initializeSchema(realDb)
    // Reset the module-level singleton's in-memory maps so tests are isolated.
    ;(
      temporaryChatService as unknown as { topics: Map<string, unknown>; messages: Map<string, unknown> }
    ).topics.clear()
    ;(
      temporaryChatService as unknown as { topics: Map<string, unknown>; messages: Map<string, unknown> }
    ).messages.clear()
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
    realDb = null
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = undefined
    }
  })

  // Minimal request envelope; only the fields each handler destructures matter.
  const req = <T extends object>(parts: T): any => ({
    ...parts,
    headers: {},
    requestId: 'rid',
    path: '/temporary/...'
  })

  // Handlers return `T | { data: T; status }` (see HandlerResult<T> in apiTypes).
  // The current handlers return raw values, so this helper narrows the union.
  // We distinguish the wrapper by `status` being a number (HTTP status code),
  // because raw Message itself has `data` + `status` fields too (status is a
  // string enum there, not a number).
  const unwrap = <T>(result: unknown): T => {
    if (
      result &&
      typeof result === 'object' &&
      'data' in result &&
      'status' in result &&
      typeof (result as { status: unknown }).status === 'number'
    ) {
      return (result as { data: T }).data
    }
    return result as T
  }

  it('persist promotes a temp chat into a persistent topic readable by messageService', async () => {
    // 1. Create a temporary topic.
    const topic = unwrap<Topic>(
      await temporaryChatHandlers['/temporary/topics'].POST(
        req({ body: { name: 'Quick question', assistantId: 'asst_1' } })
      )
    )
    expect(topic.activeNodeId).toBeNull()
    expect(topic.id).toMatch(/^temp:[0-9a-f-]{36}$/)

    // 2. Append 4 messages: user / assistant / user / assistant.
    const m1 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'user', data: mainText('hi there') } })
      )
    )
    const m2 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'assistant', data: mainText('hello back') } })
      )
    )
    const m3 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'user', data: mainText('second question') } })
      )
    )
    const m4 = unwrap<Message>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        req({ params: { topicId: topic.id }, body: { role: 'assistant', data: mainText('second answer') } })
      )
    )

    // 3. List messages via temp handler to sanity-check ordering.
    const listed = unwrap<Message[]>(
      await temporaryChatHandlers['/temporary/topics/:topicId/messages'].GET(req({ params: { topicId: topic.id } }))
    )
    expect(listed.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id, m4.id])

    // 4. Persist. The returned topicId must equal the temporary id unchanged.
    const persistResult = unwrap<PersistTemporaryChatResponse>(
      await temporaryChatHandlers['/temporary/topics/:id/persist'].POST(req({ params: { id: topic.id } }))
    )
    expect(persistResult).toEqual({ topicId: topic.id, messageCount: 4 })

    // 5. After persist, the in-memory store is cleared — temp handlers see 404.
    await expect(
      temporaryChatHandlers['/temporary/topics/:topicId/messages'].GET(req({ params: { topicId: topic.id } }))
    ).rejects.toThrow(/not found/i)

    // 6. The persistent messageService reads the topic as a linear tree with
    // activeNodeId pointing at the last message. This is the real integration
    // value — we go through the same code path as GET /topics/:id/tree.
    const tree = await messageService.getTree(topic.id, { depth: -1 })
    expect(tree.activeNodeId).toBe(m4.id)
    expect(tree.siblingsGroups).toEqual([])
    // Tree nodes are returned in traversal order; extract the linear chain.
    const ids = tree.nodes.map((n) => n.id)
    expect(ids).toEqual([m1.id, m2.id, m3.id, m4.id])
    // Every node has hasChildren correctly set (only the last one is a leaf).
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get(m1.id)!.hasChildren).toBe(true)
    expect(byId.get(m2.id)!.hasChildren).toBe(true)
    expect(byId.get(m3.id)!.hasChildren).toBe(true)
    expect(byId.get(m4.id)!.hasChildren).toBe(false)

    // 7. FTS5 trigger must have populated searchable_text for every message.
    // If this fails, persist bypassed the ORM insert path (e.g. raw SQL) and
    // the production FTS index would also be missing entries.
    const rows = (await realDb!.all(
      sql.raw(`SELECT id, searchable_text FROM message WHERE topic_id = '${topic.id}'`)
    )) as { id: string; searchable_text: string | null }[]
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.searchable_text).toBeTruthy()
    }
    // And FTS full-text search actually works.
    const ftsMatches = (await realDb!.all(
      sql.raw(`
        SELECT m.id FROM message m
        JOIN message_fts fts ON m.rowid = fts.rowid
        WHERE message_fts MATCH 'second'
      `)
    )) as { id: string }[]
    const ftsIds = new Set(ftsMatches.map((r) => r.id))
    expect(ftsIds.has(m3.id)).toBe(true)
    expect(ftsIds.has(m4.id)).toBe(true)
    expect(ftsIds.has(m1.id)).toBe(false)
  })
})
