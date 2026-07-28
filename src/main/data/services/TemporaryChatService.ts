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
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { topicProvenanceTable } from '@data/db/schemas/topicProvenance'
import {
  englishLearningImportService,
  extractEnglishLearningMessageText
} from '@data/services/EnglishLearningImportService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import type { PersistTemporaryChatDto } from '@shared/data/api/schemas/temporaryChats'
import type { CreateTopicDto } from '@shared/data/api/schemas/topics'
import type { Message, MessageRole, MessageStatus } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4, v5 as uuidv5, v7 as uuidv7 } from 'uuid'

import { messageService } from './MessageService'
import { insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:TemporaryChatService')

const VALID_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system']
const ACCEPTED_STATUSES: readonly MessageStatus[] = ['success', 'error', 'paused']
const AGGREGATE_TOPIC_NAMESPACE = 'cherry-studio:temporary-chat-aggregate:v1'

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

  createTopic(dto: CreateTopicDto): Topic {
    const now = Date.now()
    const row: TemporaryTopicRow = {
      id: uuidv4(),
      name: dto.name ?? '',
      isNameManuallyEdited: false,
      assistantId: dto.assistantId,
      activeNodeId: undefined,
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

  deleteTopic(id: string): void {
    if (!this.topics.has(id)) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', id)
    }
    this.topics.delete(id)
    this.messages.delete(id)
    logger.info('Deleted temporary topic', { id })
  }

  appendMessage(topicId: string, dto: CreateMessageDto): Message {
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
      searchableText: '',
      // Default 'success' diverges from persistent MessageService.create which
      // defaults to 'pending'. Intentional: pending placeholders are rejected
      // at the temp boundary (see assertAcceptableAppendDto), so callers must
      // only post completed messages — defaulting to 'success' matches that.
      status: dto.status ?? 'success',
      siblingsGroupId: 0,
      modelId: dto.modelId ?? null,
      messageSnapshot: dto.messageSnapshot ?? null,
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

  listMessages(topicId: string): Message[] {
    if (!this.topics.has(topicId)) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }
    const rows = this.messages.get(topicId) ?? []
    // structuredClone ensures outer mutation cannot affect the store's arrays.
    return structuredClone(rows).map(rowToMessage)
  }

  persist(
    topicId: string,
    dto: PersistTemporaryChatDto = {}
  ): { topicId: string; messageCount: number; messageIds: string[] } {
    // 1. snapshot-and-clear: take the data out of the Maps immediately so that
    // concurrent handlers can't mutate it while the DB transaction runs.
    const topic = this.topics.get(topicId)
    if (!topic) {
      throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    }

    if (dto.aggregate && !topic.assistantId) {
      throw DataApiErrorFactory.invalidOperation(
        'persist temporary chat',
        'Aggregate persistence requires an assistant-bound temporary topic'
      )
    }

    if (dto.provenance && (this.messages.get(topicId)?.length ?? 0) === 0) {
      throw DataApiErrorFactory.invalidOperation(
        'persist temporary chat',
        'Provenance requires at least one persisted message'
      )
    }

    const persistentTopicId = dto.aggregate
      ? uuidv5(JSON.stringify([AGGREGATE_TOPIC_NAMESPACE, topic.assistantId, dto.aggregate.key]), uuidv5.URL)
      : topic.id
    const msgs = this.messages.get(topicId) ?? []
    this.topics.delete(topicId)
    this.messages.delete(topicId)

    let createdPersistentTopic = false
    let persistedProvenanceId: string | undefined
    try {
      application.get('DbService').withWriteTx((tx) => {
        const [existingTopic] = tx.select().from(topicTable).where(eq(topicTable.id, persistentTopicId)).limit(1).all()

        let prevId: string
        if (existingTopic) {
          if (!dto.aggregate) {
            throw DataApiErrorFactory.invalidOperation(
              'persist temporary chat',
              `Persistent topic ${persistentTopicId} already exists`
            )
          }
          if (existingTopic.assistantId !== topic.assistantId) {
            throw DataApiErrorFactory.invalidOperation(
              'persist temporary chat',
              'Aggregate topic belongs to a different assistant'
            )
          }
          prevId = existingTopic.activeNodeId ?? messageService.getRootMessageIdTx(tx, persistentTopicId)
        } else {
          // 2. Insert the topic. Timestamps / defaults are filled by Drizzle's
          // $defaultFn; the in-memory ISO timestamps do not cross the boundary.
          // `orderKey` places a newly-created aggregate at the tail of live topics.
          insertWithOrderKey(
            tx,
            topicTable,
            {
              id: persistentTopicId,
              name: dto.aggregate?.name ?? topic.name ?? undefined,
              assistantId: topic.assistantId ?? undefined
            },
            {
              pkColumn: topicTable.id,
              scope: isNull(topicTable.deletedAt)
            }
          )
          prevId = messageService.createRootMessageTx(tx, persistentTopicId)
          createdPersistentTopic = true
        }

        // 3. Linearize buffered messages after the aggregate topic's current
        // active node. Generation happened in the isolated temporary topic;
        // this chain is only the durable history projection.
        for (const m of msgs) {
          tx.insert(messageTable)
            .values({
              id: m.id,
              topicId: persistentTopicId,
              parentId: prevId,
              role: m.role,
              data: m.data,
              status: m.status,
              siblingsGroupId: 0,
              modelId: m.modelId ?? undefined,
              messageSnapshot: m.messageSnapshot ?? undefined,
              stats: m.stats ?? undefined
            })
            .run()
          prevId = m.id
        }

        // 4. Set activeNodeId to the last real message. Empty sessions leave an
        // existing active node unchanged and a new topic's active node null.
        if (msgs.length > 0) {
          tx.update(topicTable).set({ activeNodeId: prevId }).where(eq(topicTable.id, persistentTopicId)).run()
        }

        if (dto.provenance && msgs.length > 0) {
          const provenance = tx
            .insert(topicProvenanceTable)
            .values({
              topicId: persistentTopicId,
              kind: dto.provenance.kind,
              data: dto.provenance,
              firstMessageId: msgs[0].id,
              lastMessageId: msgs[msgs.length - 1].id
            })
            .returning({ id: topicProvenanceTable.id })
            .get()
          persistedProvenanceId = provenance.id
        }
      })
    } catch (err) {
      // Transaction failed: restore the snapshot so the user can retry.
      this.topics.set(topicId, topic)
      this.messages.set(topicId, msgs)
      throw err
    }

    notifyDataApiDataChange([
      {
        endpoint: '/topics',
        kind: createdPersistentTopic ? 'membership' : 'projection',
        entityIds: [persistentTopicId]
      },
      { endpoint: '/topics/:id', entityIds: [persistentTopicId] }
    ])
    if (persistedProvenanceId && dto.provenance?.kind === 'selection-action' && dto.provenance.actionId === 'refine') {
      englishLearningImportService.registerSelectionRefineBestEffort({
        provenanceId: persistedProvenanceId,
        selectedText: dto.provenance.selectedText,
        refinedText: extractEnglishLearningMessageText(msgs[msgs.length - 1].data)
      })
    }
    logger.info('Persisted temporary topic', {
      temporaryTopicId: topicId,
      persistentTopicId,
      aggregateKey: dto.aggregate?.key,
      provenanceKind: dto.provenance?.kind,
      messageCount: msgs.length
    })
    return { topicId: persistentTopicId, messageCount: msgs.length, messageIds: msgs.map((message) => message.id) }
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
