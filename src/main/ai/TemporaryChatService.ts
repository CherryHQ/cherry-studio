import path from 'node:path'

import type { FileUIPart } from 'ai'
import mime from 'mime'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { aiUsageRecordService, mergeMessageUsageProjection } from '@data/services/AiUsageRecordService'
import { topicService } from '@data/services/TopicService'
import { isConversationActivityRole } from '@data/services/utils/activityTime'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { copy, ensureDir, isSameOrInside, removeDir, write } from '@main/utils/file'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import type { CreateTopicDto } from '@shared/data/api/schemas/topics'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type {
  Message,
  MessageData,
  MessageRole,
  MessageRuntimeStatsInput,
  MessageStatus
} from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { toFileUrl, tryFileUrlToPath } from '@shared/utils/file'

const logger = loggerService.withContext('TemporaryChatService')

const VALID_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system']
const ACCEPTED_STATUSES: readonly MessageStatus[] = ['success', 'error', 'paused']

type TemporaryTopicRow = Omit<Topic, 'createdAt' | 'lastActivityAt' | 'updatedAt'> & {
  createdAt: number
  lastActivityAt: number
  updatedAt: number
}

type TemporaryMessageRow = Omit<Message, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt: number
}

function rowToTopic(row: TemporaryTopicRow): Topic {
  return {
    ...row,
    lastActivityAt: new Date(row.lastActivityAt).toISOString(),
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

@Injectable('TemporaryChatService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager'])
export class TemporaryChatService extends BaseService {
  private readonly persisted = new Emitter<string>()
  readonly onPersisted: Event<string> = this.persisted.event

  private topics = new Map<string, TemporaryTopicRow>()
  private messages = new Map<string, TemporaryMessageRow[]>()
  private closing = new Set<string>()
  private pending = new Map<string, Set<Promise<unknown>>>()
  private stopping = false
  private turns = new Map<string, AbortController>()

  protected async onInit(): Promise<void> {
    await this.removeDirectory(application.getPath('feature.temporary_chat.temp'))
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    for (const controller of this.turns.values()) controller.abort()
    await Promise.allSettled([...this.pending.values()].flatMap((tasks) => [...tasks]))
    this.topics.clear()
    this.messages.clear()
    this.turns.clear()
    await this.removeDirectory(application.getPath('feature.temporary_chat.temp'))
  }

  protected onDestroy(): void {
    this.persisted.dispose()
  }

  private directory(topicId: string): string {
    return application.getPath('feature.temporary_chat.temp', topicId)
  }

  private assertAvailable(topicId: string): void {
    if (this.stopping) throw new Error('Temporary chat service is stopping')
    if (!this.topics.has(topicId)) throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    if (this.closing.has(topicId)) throw new Error('Temporary chat is being saved or deleted')
  }

  private run<T>(topicId: string, operation: () => Promise<T>): Promise<T> {
    this.assertAvailable(topicId)
    const tasks = this.pending.get(topicId) ?? new Set<Promise<unknown>>()
    this.pending.set(topicId, tasks)
    const task = operation()
    tasks.add(task)
    const settled = () => {
      tasks.delete(task)
      if (tasks.size === 0) this.pending.delete(topicId)
    }
    void task.then(settled, settled)
    return task
  }

  beginTurn(topicId: string): AbortController {
    this.assertAvailable(topicId)
    if (this.turns.has(topicId)) throw new Error('Temporary chat already has an active turn')
    const controller = new AbortController()
    this.turns.set(topicId, controller)
    return controller
  }

  finishTurn(topicId: string): void {
    this.turns.delete(topicId)
  }

  createTopic(dto: CreateTopicDto): Topic {
    if (this.stopping) throw new Error('Temporary chat service is stopping')
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
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now
    }
    this.topics.set(row.id, row)
    this.messages.set(row.id, [])
    logger.info('Created temporary topic', { id: row.id })
    return rowToTopic(row)
  }

  async deleteTopic(id: string): Promise<void> {
    if (this.closing.has(id)) {
      await Promise.allSettled([...(this.pending.get(id) ?? [])])
      if (!this.topics.has(id)) return
    }
    const pending = [...(this.pending.get(id) ?? [])]
    return this.run(id, async () => {
      this.closing.add(id)
      this.turns.get(id)?.abort()
      await Promise.allSettled(pending)
      this.topics.delete(id)
      this.messages.delete(id)
      this.turns.delete(id)
      await this.removeDirectory(this.directory(id))
      this.closing.delete(id)
    })
  }

  async appendMessage(topicId: string, dto: CreateMessageDto, messageId?: string): Promise<Message> {
    return this.appendMessageWithStats(topicId, dto, undefined, messageId)
  }

  async appendAssistantMessage(
    topicId: string,
    dto: Omit<CreateMessageDto, 'role'> & { role: 'assistant' },
    runtimeStats: MessageRuntimeStatsInput | undefined,
    messageId: string
  ): Promise<Message> {
    const projection = aiUsageRecordService.getMessageUsageProjection({ kind: 'chat', id: messageId })
    return this.appendMessageWithStats(topicId, dto, mergeMessageUsageProjection(runtimeStats, projection), messageId)
  }

  private async appendMessageWithStats(
    topicId: string,
    dto: CreateMessageDto,
    stats: Message['stats'] | undefined,
    messageId?: string
  ): Promise<Message> {
    this.assertAvailable(topicId)
    this.assertAcceptableAppendDto(dto)
    return this.run(topicId, async () => {
      dto = { ...dto, data: await this.storeAttachments(topicId, dto.data) }
      const now = Date.now()
      const row: TemporaryMessageRow = {
        id: messageId ?? uuidv7(),
        topicId,
        parentId: null,
        role: dto.role,
        data: dto.data,
        searchableText: '',
        status: dto.status ?? 'success',
        siblingsGroupId: 0,
        modelId: dto.modelId ?? null,
        messageSnapshot: dto.messageSnapshot ?? null,
        stats: stats ?? null,
        createdAt: now,
        updatedAt: now
      }
      const list = this.messages.get(topicId)
      if (!list) {
        throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
      }
      list.push(row)
      const topic = this.topics.get(topicId)
      if (topic && isConversationActivityRole(row.role)) {
        topic.lastActivityAt = Math.max(topic.lastActivityAt, now)
        topic.updatedAt = now
      }
      return rowToMessage(row)
    })
  }

  hasTopic(topicId: string): boolean {
    return this.topics.has(topicId)
  }

  getTopic(topicId: string): Topic | null {
    const topic = this.topics.get(topicId)
    return topic ? rowToTopic(topic) : null
  }

  listMessages(topicId: string): Message[] {
    if (!this.topics.has(topicId)) throw DataApiErrorFactory.notFound('TemporaryTopic', topicId)
    return structuredClone(this.messages.get(topicId) ?? []).map(rowToMessage)
  }

  async storeGeneratedFile<T extends FileUIPart>(topicId: string, part: T): Promise<T> {
    return this.run(topicId, () => this.storeFile(topicId, part))
  }

  private async storeAttachments(topicId: string, data: MessageData): Promise<MessageData> {
    const parts: NonNullable<MessageData['parts']> = []
    for (const part of data.parts ?? []) {
      parts.push(part.type === 'file' ? await this.storeFile(topicId, part) : part)
    }
    return { ...data, parts }
  }

  private async storeFile<T extends FileUIPart>(topicId: string, part: T): Promise<T> {
    const entryId = readCherryMeta(part)?.fileEntryId
    const source = entryId
      ? application.get('FileManager').getPhysicalPath(FileEntryIdSchema.parse(entryId))
      : tryFileUrlToPath(part.url)
    const directory = this.directory(topicId)
    if (source && isSameOrInside(source, directory)) return part
    const inline = parseDataUrl(part.url)
    if (!source && !inline) return part
    if (inline && (!inline.isBase64 || !inline.data)) throw new Error('Generated attachment has no file content')
    const ext = mime.getExtension(part.mediaType) ?? (source ? path.extname(source).slice(1) : '')
    const target = AbsoluteFilePathSchema.parse(path.join(directory, uuidv7() + (ext ? '.' + ext : '')))
    await ensureDir(AbsoluteFilePathSchema.parse(directory))
    if (source) await copy(AbsoluteFilePathSchema.parse(source), target)
    else await write(target, Buffer.from(inline!.data, 'base64'))
    return { ...part, ...withCherryMeta<FileUIPart>({ ...part, url: toFileUrl(target) }, { fileEntryId: undefined }) }
  }

  async persist(topicId: string): Promise<{ topicId: string; messageCount: number }> {
    this.assertAvailable(topicId)
    if (this.turns.has(topicId)) throw new Error('Cannot save a temporary chat while a turn is active')
    const pending = [...(this.pending.get(topicId) ?? [])]
    return this.run(topicId, async () => {
      this.closing.add(topicId)
      const manager = application.get('FileManager')
      const created: string[] = []
      try {
        await Promise.all(pending)
        const topic = rowToTopic(this.topics.get(topicId)!)
        const messages = this.listMessages(topicId)
        const entries = new Map<string, string>()
        for (const message of messages) {
          for (const part of message.data.parts ?? []) {
            if (part.type !== 'file') continue
            const source = tryFileUrlToPath(part.url)
            if (!source || !isSameOrInside(source, this.directory(topicId))) continue
            let entryId = entries.get(source)
            if (!entryId) {
              const entry = await manager.createInternalEntry({
                source: 'path',
                path: AbsoluteFilePathSchema.parse(source),
                cleanupPolicy: 'delete_when_unreferenced'
              })
              entryId = entry.id
              entries.set(source, entryId)
              created.push(entryId)
            }
            Object.assign(
              part,
              withCherryMeta(
                { ...part, url: manager.getUrl(FileEntryIdSchema.parse(entryId)) },
                { fileEntryId: entryId }
              )
            )
          }
        }
        topicService.importConversation(topic, messages)
      } catch (error) {
        await Promise.allSettled(created.map((id) => manager.permanentDelete(FileEntryIdSchema.parse(id))))
        throw error
      } finally {
        this.closing.delete(topicId)
      }
      const messageCount = this.messages.get(topicId)!.length
      this.topics.delete(topicId)
      this.messages.delete(topicId)
      this.persisted.fire(topicId)
      await this.removeDirectory(this.directory(topicId))
      return { topicId, messageCount }
    })
  }

  private async removeDirectory(directory: string): Promise<void> {
    try {
      await removeDir(AbsoluteFilePathSchema.parse(directory))
    } catch (error) {
      logger.warn('Failed to remove temporary chat files', { error })
    }
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
