import { and, count, eq, isNull } from 'drizzle-orm'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { sideChatTable } from '@data/db/schemas/sideChat'
import { topicTable } from '@data/db/schemas/topic'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { Message } from '@shared/data/types/message'
import {
  SideChatConfigSchema,
  SideChatSourceSchema,
  type SideChatConfig,
  type SideChatMetadata,
  type SideChatSnapshot,
  type SideChatSource
} from '@shared/data/types/sideChat'

import { messageService } from './MessageService'
import { topicService } from './TopicService'

function textOf(message: Message): string {
  return message.data.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export class SideChatService {
  captureSource(input: SideChatSource): SideChatSnapshot {
    const source = SideChatSourceSchema.parse(input)
    topicService.getById(source.topicId)
    if (this.find(source.topicId))
      throw DataApiErrorFactory.invalidOperation('create side chat', 'Nested side chats are unsupported')
    const answer = messageService.getById(source.messageId)
    if (answer.topicId !== source.topicId || answer.role !== 'assistant') {
      throw DataApiErrorFactory.invalidOperation('create side chat', 'Source must be an answer in the selected topic')
    }
    const answerText = textOf(answer)
    const selection = source.selection ?? answerText
    const offset = answerText.indexOf(selection)
    if (!selection || offset < 0)
      throw DataApiErrorFactory.invalidOperation('create side chat', 'Selection does not match the source answer')
    const question = messageService.getPathToNode(answer.id).findLast((message) => message.role === 'user')
    if (!question) throw DataApiErrorFactory.invalidOperation('create side chat', 'Source answer has no user question')
    const unique = answerText.indexOf(selection, offset + 1) < 0
    return {
      messageId: answer.id,
      selection,
      answer: answerText,
      question: textOf(question),
      prefix: unique ? answerText.slice(Math.max(0, offset - 80), offset) : '',
      suffix: unique ? answerText.slice(offset + selection.length, offset + selection.length + 80) : ''
    }
  }

  find(topicId: string) {
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(sideChatTable)
      .where(eq(sideChatTable.topicId, topicId))
      .get()
  }

  create(source: SideChatSource, config: SideChatConfig) {
    const parsedConfig = SideChatConfigSchema.parse(config)
    const row = application.get('DbService').withWriteTx((tx) => {
      const metadata: SideChatMetadata = { snapshot: this.captureSource(source), config: parsedConfig }
      const topic = topicService.createTx(tx, { name: '' })
      tx.insert(sideChatTable).values({ topicId: topic.id, sourceTopicId: source.topicId, metadata }).run()
      return { topicId: topic.id, sourceTopicId: source.topicId, metadata }
    })
    topicService.notifyReadModelChange([row.topicId], 'membership')
    return { ...row, questionCount: 0 }
  }

  get(topicId: string) {
    const row = this.find(topicId)
    if (!row) throw DataApiErrorFactory.notFound('SideChat', topicId)
    topicService.getById(row.sourceTopicId)
    topicService.getById(topicId)
    return { ...row, questionCount: this.questionCount(topicId) }
  }

  list(sourceTopicId: string) {
    topicService.getById(sourceTopicId)
    return application
      .get('DbService')
      .getDb()
      .select({
        topicId: sideChatTable.topicId,
        sourceTopicId: sideChatTable.sourceTopicId,
        metadata: sideChatTable.metadata
      })
      .from(sideChatTable)
      .innerJoin(topicTable, eq(topicTable.id, sideChatTable.topicId))
      .where(and(eq(sideChatTable.sourceTopicId, sourceTopicId), isNull(topicTable.deletedAt)))
      .all()
      .map((row) => ({ ...row, questionCount: this.questionCount(row.topicId) }))
  }

  questionCount(topicId: string): number {
    return application
      .get('DbService')
      .getDb()
      .select({ total: count() })
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), eq(messageTable.role, 'user'), isNull(messageTable.deletedAt)))
      .get()!.total
  }

  updateConfig(topicId: string, config: SideChatConfig): void {
    const parsed = SideChatConfigSchema.parse(config)
    application.get('DbService').withWriteTx((tx) => {
      const row = this.get(topicId)
      tx.update(sideChatTable)
        .set({ metadata: { ...row.metadata, config: parsed } })
        .where(eq(sideChatTable.topicId, topicId))
        .run()
    })
    topicService.notifyReadModelChange([topicId], 'projection')
  }
}

export const sideChatService = new SideChatService()
