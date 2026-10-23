// First: modules below parse zod schemas while loading (see src/runtime/zodJitless.ts).
import '../src/runtime/zodJitless'
import fs from 'node:fs/promises'

import { CUSTOM_SQL_STATEMENTS } from '@data/db/customSqls'
import { messageService } from '@data/services/MessageService'
import type { StreamListener } from '@main/ai/streamManager/types'

import { application } from '../src/runtime/application'
import { type CommandHandler, startCoreWorker, type WorkerScope } from '../src/worker/startCoreWorker'

// Test-only commands next to the core ones: raw SQL, bulk seeding and integrity checks.
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0))

const sql: CommandHandler = ({ sql, params = [], mode = 'all' }, context) => {
  const statement = context.database().service.sqlite.prepare(sql)
  return mode === 'run'
    ? statement.run(...params)
    : mode === 'get'
      ? statement.get(...params)
      : statement.all(...params)
}

interface SeedOptions {
  count: number
  messagesPerTopic?: number
  chunkSize?: number
  /** Write everything in one transaction (the crash test's long synchronous task). */
  singleTransaction?: boolean
  prefix?: string
}

/**
 * Inserts `count` messages as linear conversations of `messagesPerTopic`. Chunked
 * writes yield between transactions so no Worker task runs long; the returned
 * `maxChunkMs` is the longest task.
 */
const seedMessages: CommandHandler = async (options: SeedOptions, context) => {
  const { count, messagesPerTopic = 100, chunkSize = 2000, singleTransaction = false, prefix = 'seed' } = options
  const { sqlite } = context.database().service
  const insertTopic = sqlite.prepare(
    'INSERT INTO topic (id, name, order_key, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const setActiveNode = sqlite.prepare('UPDATE topic SET active_node_id = ? WHERE id = ?')
  const insertMessage = sqlite.prepare(
    'INSERT INTO message (id, parent_id, topic_id, role, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const base = Date.now()
  let parentId: string | null = null
  let topicId = ''
  const writeRange = sqlite.transaction((from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const position = i % messagesPerTopic
      const createdAt = base + i
      if (position === 0) {
        const topicIndex = i / messagesPerTopic
        topicId = `${prefix}-topic-${topicIndex}`
        const orderKey = `${prefix}${String(topicIndex).padStart(8, '0')}`
        insertTopic.run(topicId, `Topic ${topicIndex}`, orderKey, createdAt, createdAt, createdAt)
        parentId = `${topicId}-root`
        insertMessage.run(parentId, null, topicId, 'root', '{"parts":[]}', 'success', createdAt, createdAt)
      }
      const id = `${topicId}-m${position}`
      const data = JSON.stringify({
        parts: [
          { type: 'text', text: `message ${i} about topic ${topicId} needle${i % 1000} lorem ipsum dolor sit amet` }
        ]
      })
      insertMessage.run(
        id,
        parentId,
        topicId,
        position % 2 === 0 ? 'user' : 'assistant',
        data,
        'success',
        createdAt,
        createdAt
      )
      parentId = id
      if (position === messagesPerTopic - 1 || i === count - 1) setActiveNode.run(id, topicId)
    }
  })

  const started = performance.now()
  let maxChunkMs = 0
  const size = singleTransaction ? count : chunkSize
  for (let from = 0; from < count; from += size) {
    const chunkStarted = performance.now()
    writeRange.immediate(from, Math.min(from + size, count))
    maxChunkMs = Math.max(maxChunkMs, performance.now() - chunkStarted)
    if (!singleTransaction) await yieldToEventLoop()
  }
  return { inserted: count, ms: performance.now() - started, maxChunkMs }
}

const integrity: CommandHandler = (_payload, context) => {
  const { sqlite } = context.database().service
  return {
    integrity: sqlite.pragma('integrity_check', { simple: true }),
    foreignKeyViolations: (sqlite.pragma('foreign_key_check') as unknown[]).length
  }
}

/** Times the parts of `applyMigrations` that scan data on every boot, on an already-migrated database. */
const bootBreakdown: CommandHandler = (_payload, context) => {
  const { sqlite } = context.database().service
  const time = (fn: () => unknown) => {
    const started = performance.now()
    fn()
    return performance.now() - started
  }
  return {
    foreignKeyCheckMs: time(() => sqlite.pragma('foreign_key_check')),
    customSqlMs: time(() => CUSTOM_SQL_STATEMENTS.forEach((statement) => sqlite.exec(statement)))
  }
}

const searchMessages: CommandHandler = ({ q, topicId }: { q: string; topicId?: string }, context) => {
  context.database()
  return messageService.search({ q, topicId, limit: 20 })
}

interface ChatOptions {
  topicId: string
  text: string
  /** The topic's active tip; omitted for the first message. */
  parentAnchorId?: string
}

/** Sends one user message the way the chat composer does and waits until the reply is persisted. */
const chat: CommandHandler = async ({ topicId, text, parentAnchorId }: ChatOptions, context) => {
  context.database()
  const deltas: string[] = []
  let settle!: (outcome: { status: string; error?: string }) => void
  const settled = new Promise<{ status: string; error?: string }>((resolve) => (settle = resolve))
  const listener: StreamListener = {
    id: `harness-chat-${crypto.randomUUID()}`,
    onChunk: (chunk) => {
      if (chunk.type === 'text-delta') deltas.push(chunk.delta)
    },
    onDone: () => settle({ status: 'success' }),
    onPaused: () => settle({ status: 'paused' }),
    onError: ({ error }) => settle({ status: 'error', error: error.message ?? undefined }),
    isAlive: () => true
  }
  const admission = await application.get('AiStreamManager').dispatch(listener, {
    topicId,
    trigger: 'submit-message',
    parentAnchorId,
    userMessageParts: [{ type: 'text', text }]
  })
  return { admission, ...(await settled), deltas }
}

/** The Worker's `node:fs/promises` call `method(...args)`, as the agent's file tools make it; stats come back as size and kind. */
const fsCall: CommandHandler = async ({ method, args }: { method: keyof typeof fs; args: unknown[] }) => {
  const result = await (fs[method] as (...args: unknown[]) => Promise<unknown>)(...args)
  if (method !== 'stat') return result
  const stats = result as Awaited<ReturnType<typeof fs.stat>>
  return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory() }
}

type PermissionPrototype = { queryPermission?: (descriptor: unknown) => Promise<PermissionState> }
const handlePrototype = FileSystemHandle.prototype as PermissionPrototype
const grantedQuery = handlePrototype.queryPermission

/** Makes stored folders report a lapsed permission, as after a reload without a lasting grant, or restores them. */
const revokeFolderPermission: CommandHandler = ({ revoked }: { revoked: boolean }) => {
  if (revoked) handlePrototype.queryPermission = async () => 'prompt'
  else if (grantedQuery) handlePrototype.queryPermission = grantedQuery
  else delete handlePrototype.queryPermission
}

startCoreWorker(self as unknown as WorkerScope, {
  sql,
  seedMessages,
  integrity,
  bootBreakdown,
  searchMessages,
  chat,
  fsCall,
  revokeFolderPermission
})
