/**
 * TemporaryChatService — in-memory backend for temporary chats.
 *
 * A temporary chat behaves like a regular topic + message conversation but
 * never touches SQLite until the user explicitly persists it. Data lives in
 * Maps on the main process and is discarded on delete, persist, or process
 * exit.
 *
 * Simplifications relative to the persistent topic / message API:
 * - Linear messages (no branching / siblings / activeNodeId).
 * - Messages are immutable once appended (no PATCH / delete-message).
 * - In-memory lifecycle only (no DB, no FTS5, no pagination).
 */

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import type { CreateTopicDto } from '@shared/data/api/schemas/topics'
import type { Message, MessageRole, MessageStatus } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:TemporaryChatService')

const VALID_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system']
const ACCEPTED_STATUSES: readonly MessageStatus[] = ['success', 'error', 'paused']

/**
 * Internal row types — timestamps stored as millisecond numbers to match the
 * DB's `integer()` column type. Converted to ISO strings at the service
 * boundary so callers see `Topic` / `Message` contract unchanged.
 */
type TemporaryTopicRow = Omit<Topic, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt: number
}

type TemporaryMessageRow = Omit<Message, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt: number
}

function rowToTopic(row: TemporaryTopicRow): Topic {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  }
}

function rowToMessage(row: TemporaryMessageRow): Message {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  }
}

export class TemporaryChatService {
  private topics = new Map<string, TemporaryTopicRow>()
  private messages = new Map<string, TemporaryMessageRow[]>()

  async createTopic(dto: CreateTopicDto): Promise<Topic> {
    if (dto.sourceNodeId != null) {
      throw DataApiErrorFactory.validation({
        sourceNodeId: ['fork (sourceNodeId) is not supported for temporary chats']
      })
    }
    const now = Date.now()
    const row: TemporaryTopicRow = {
      id: uuidv4(),
      name: dto.name ?? null,
      isNameManuallyEdited: false,
      assistantId: dto.assistantId ?? null,
      activeNodeId: null,
      groupId: dto.groupId ?? null,
      // In-memory store has no real ordering — temp topics are scoped per
      // session and never reordered or paginated like persistent ones.
      orderKey: '',
      createdAt: now,
      updatedAt: now
    }
    this.topics.set(row.id, row)
    this.messages.set(row.id, [])
    logger.info('Created temporary topic', { id: row.id })
    return rowToTopic(row)
  }

  async deleteTopic(id: string): Promise<void> {
    if (!this.topics.has(id)) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', id)
    }
    this.topics.delete(id)
    this.messages.delete(id)
    logger.info('Deleted temporary topic', { id })
  }

  async appendMessage(topicId: string, dto: CreateMessageDto): Promise<Message> {
    if (!this.topics.has(topicId)) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }
    this.assertAcceptableAppendDto(dto)

    const now = Date.now()
    const row: TemporaryMessageRow = {
      id: uuidv7(),
      topicId,
      parentId: null,
      role: dto.role,
      data: dto.data,
      searchableText: null,
      // Default 'success' diverges from persistent MessageService.create which
      // defaults to 'pending'. Intentional: pending placeholders are rejected
      // at the temp boundary (see assertAcceptableAppendDto), so callers must
      // only post completed messages — defaulting to 'success' matches that.
      status: dto.status ?? 'success',
      siblingsGroupId: 0,
      modelId: dto.modelId ?? null,
      modelSnapshot: dto.modelSnapshot ?? null,
      traceId: dto.traceId ?? null,
      stats: dto.stats ?? null,
      createdAt: now,
      updatedAt: now
    }
    // Race: deleteTopic between the topics.has check above and this line
    // would leave .get() returning undefined. Surface as NotFound rather than
    // crashing with TypeError on `.push` of undefined.
    const list = this.messages.get(topicId)
    if (!list) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }
    list.push(row)
    return rowToMessage(row)
  }

  /**
   * Main-process internal API — test whether a topicId is currently managed
   * by this service. Routing helpers (e.g. TemporaryChatContextProvider)
   * use this to decide whether the topic lives in memory; after `persist()`
   * the id survives in SQLite, so routing must fall through to the
   * persistent path when this returns false.
   */
  hasTopic(topicId: string): boolean {
    return this.topics.has(topicId)
  }

  /** Main-process internal API — read-only topic accessor (returns ISO-timestamp Topic). */
  getTopic(topicId: string): Topic | null {
    const row = this.topics.get(topicId)
    return row ? rowToTopic(row) : null
  }

  async listMessages(topicId: string): Promise<Message[]> {
    if (!this.topics.has(topicId)) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }
    const rows = this.messages.get(topicId) ?? []
    // structuredClone ensures outer mutation cannot affect the store's arrays.
    return structuredClone(rows).map(rowToMessage)
  }

  async persist(topicId: string): Promise<{ topicId: string; messageCount: number }> {
    // 1. snapshot-and-clear: take the data out of the Maps immediately so that
    // concurrent handlers can't mutate it while the DB transaction is awaiting.
    const topic = this.topics.get(topicId)
    if (!topic) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }
    const msgs = this.messages.get(topicId) ?? []
    this.topics.delete(topicId)
    this.messages.delete(topicId)

    try {
      const db = application.get('DbService').getDb()
      await db.transaction(async (tx) => {
        // 2. Insert topic with the same id. Timestamps / defaults are filled by
        // Drizzle's $defaultFn; we do not pass createdAt / updatedAt manually
        // because the TS-side ISO strings don't match the DB's integer column.
        //
        // `orderKey` is computed via `insertWithOrderKey` so the new persisted
        // topic lands at the tail of its `groupId` partition, matching what
        // `topicService.create` does for normal topics. The `?? undefined`
        // pattern used for the other fields converts `null` to `undefined`
        // so Drizzle omits the column entirely, letting the DB default apply.
        const groupIdForScope = topic.groupId ?? null
        await insertWithOrderKey(
          tx,
          topicTable,
          {
            id: topic.id,
            name: topic.name ?? undefined,
            assistantId: topic.assistantId ?? undefined,
            groupId: topic.groupId ?? undefined
          },
          {
            pkColumn: topicTable.id,
            scope: groupIdForScope === null ? isNull(topicTable.groupId) : eq(topicTable.groupId, groupIdForScope)
          }
        )

        // 3. Linearize: parentId[i] = msgs[i-1].id. First message's parent is null.
        let prevId: string | null = null
        for (const m of msgs) {
          await tx.insert(messageTable).values({
            id: m.id,
            topicId: topic.id,
            parentId: prevId,
            role: m.role,
            data: m.data,
            status: m.status,
            siblingsGroupId: 0,
            modelId: m.modelId ?? undefined,
            modelSnapshot: m.modelSnapshot ?? undefined,
            traceId: m.traceId ?? undefined,
            stats: m.stats ?? undefined
          })
          prevId = m.id
        }

        // 4. Set activeNodeId to the last message (if any).
        if (prevId) {
          await tx.update(topicTable).set({ activeNodeId: prevId }).where(eq(topicTable.id, topic.id))
        }
      })
    } catch (err) {
      // Transaction failed: restore the snapshot so the user can retry.
      this.topics.set(topicId, topic)
      this.messages.set(topicId, msgs)
      throw err
    }

    logger.info('Persisted temporary topic', { topicId, messageCount: msgs.length })
    return { topicId, messageCount: msgs.length }
  }

  private assertAcceptableAppendDto(dto: CreateMessageDto): void {
    const errors: Record<string, string[]> = {}

    if (dto.parentId != null) {
      errors.parentId = ['parentId is not supported in temporary chats (no branching)']
    }
    if (dto.siblingsGroupId != null && dto.siblingsGroupId !== 0) {
      errors.siblingsGroupId = ['non-zero siblingsGroupId is not supported in temporary chats']
    }
    if (dto.setAsActive != null) {
      errors.setAsActive = ['setAsActive is not supported in temporary chats (no activeNode)']
    }
    if (dto.status === 'pending') {
      errors.status = ['status=pending is not supported; post completed messages only']
    }
    if (dto.role == null || !VALID_ROLES.includes(dto.role)) {
      errors.role = [`role must be one of ${VALID_ROLES.join(', ')}`]
    }
    if (dto.status != null && !ACCEPTED_STATUSES.includes(dto.status) && dto.status !== 'pending') {
      errors.status ??= [`status must be one of ${ACCEPTED_STATUSES.join(', ')}`]
    }

    if (Object.keys(errors).length > 0) {
      throw DataApiErrorFactory.validation(errors)
    }
  }
}

export const temporaryChatService = new TemporaryChatService()
