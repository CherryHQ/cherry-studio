import { and, count, eq, isNull } from 'drizzle-orm'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'
import {
  SideChatConfigSchema,
  SideChatSourceSchema,
  SideChatSourceIdSchema,
  SideChatRootDataSchema,
  type SideChatConfig,
  type SideChatMetadata,
  type SideChatSnapshot,
  type SideChatSource
} from '@shared/data/types/sideChat'

import { agentSessionMessageService } from './AgentSessionMessageService'
import { readAgentSessionPath } from './agentSessionMessageTree'
import { agentSessionService } from './AgentSessionService'
import { messageService } from './MessageService'
import { topicService } from './TopicService'
import { sideChatRootFilter, sideChatSourceTopicId } from './utils/sideChatRoot'

function textOf(message: { data: { parts: CherryMessagePart[] } }): string {
  return message.data.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export class SideChatService {
  assertSource(sourceTopicId: string): void {
    SideChatSourceIdSchema.parse(sourceTopicId)
    if (!sourceTopicId.startsWith('agent-session:')) {
      topicService.getById(sourceTopicId)
      return
    }
    const session = agentSessionService.getConversationById(sourceTopicId.slice('agent-session:'.length))
    if (session.agentId) {
      const agent = application
        .get('DbService')
        .getDb()
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, session.agentId), isNull(agentTable.deletedAt)))
        .get()
      if (!agent) throw DataApiErrorFactory.notFound('Agent', session.agentId)
    }
  }

  captureSource(input: SideChatSource): SideChatSnapshot {
    const source = SideChatSourceSchema.parse(input)
    this.assertSource(source.topicId)
    if (this.find(source.topicId))
      throw DataApiErrorFactory.invalidOperation('create side chat', 'Nested side chats are unsupported')
    const sessionId = source.topicId.startsWith('agent-session:') ? source.topicId.slice('agent-session:'.length) : null
    const answer = sessionId
      ? agentSessionMessageService.getSessionMessage(sessionId, source.messageId)
      : messageService.getById(source.messageId)
    if ((!sessionId && 'topicId' in answer && answer.topicId !== source.topicId) || answer.role !== 'assistant') {
      throw DataApiErrorFactory.invalidOperation('create side chat', 'Source must be an answer in the selected topic')
    }
    const answerText = textOf(answer)
    const selection = source.selection ?? answerText
    const offset = answerText.indexOf(selection)
    if (!selection.trim()) throw DataApiErrorFactory.invalidOperation('create side chat', 'Selection must contain text')
    const path = sessionId
      ? readAgentSessionPath(application.get('DbService').getDb(), sessionId, answer.id)
      : messageService.getPathToNode(answer.id)
    const question = path.findLast((message) => message.role === 'user')
    if (!question) throw DataApiErrorFactory.invalidOperation('create side chat', 'Source answer has no user question')
    // Rendered quotes may omit Markdown syntax; only exact matches can anchor source highlights.
    const unique = offset >= 0 && answerText.indexOf(selection, offset + 1) < 0
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
    const root = application
      .get('DbService')
      .getDb()
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.topicId, topicId), sideChatRootFilter()))
      .get()
    if (!root) return undefined
    const { sourceTopicId, snapshot, config } = SideChatRootDataSchema.parse(root.data).sideChat
    return { topicId, sourceTopicId, metadata: { snapshot, config } }
  }

  create(source: SideChatSource, config: SideChatConfig) {
    const parsedConfig = SideChatConfigSchema.parse(config)
    const row = application.get('DbService').withWriteTx((tx) => {
      const metadata: SideChatMetadata = { snapshot: this.captureSource(source), config: parsedConfig }
      const topic = topicService.createTx(tx, { name: '' })
      const data = SideChatRootDataSchema.parse({
        parts: [],
        sideChat: { ...metadata, sourceTopicId: source.topicId, version: 1 }
      })
      tx.update(messageTable)
        .set({ data })
        .where(and(eq(messageTable.topicId, topic.id), eq(messageTable.role, 'root')))
        .run()
      return { topicId: topic.id, sourceTopicId: source.topicId, metadata }
    })
    topicService.notifyReadModelChange([row.topicId], 'membership')
    return { ...row, questionCount: 0 }
  }

  get(topicId: string) {
    const row = this.find(topicId)
    if (!row) throw DataApiErrorFactory.notFound('SideChat', topicId)
    this.assertSource(row.sourceTopicId)
    topicService.getById(topicId)
    return { ...row, questionCount: this.questionCount(topicId) }
  }

  list(sourceTopicId: string) {
    this.assertSource(sourceTopicId)
    return application
      .get('DbService')
      .getDb()
      .select({
        topicId: messageTable.topicId
      })
      .from(messageTable)
      .innerJoin(topicTable, eq(topicTable.id, messageTable.topicId))
      .where(and(sideChatRootFilter(), eq(sideChatSourceTopicId, sourceTopicId), isNull(topicTable.deletedAt)))
      .all()
      .map((row) => this.get(row.topicId))
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
      const data = SideChatRootDataSchema.parse({
        parts: [],
        sideChat: { ...row.metadata, config: parsed, sourceTopicId: row.sourceTopicId, version: 1 }
      })
      tx.update(messageTable)
        .set({ data })
        .where(and(eq(messageTable.topicId, topicId), sideChatRootFilter()))
        .run()
    })
    topicService.notifyReadModelChange([topicId], 'projection')
  }
}

export const sideChatService = new SideChatService()
