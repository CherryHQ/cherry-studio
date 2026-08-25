import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import type { ChatRecordStats, DiagnosticTimeRange, DiagnosticWarning, StagedSource } from './types'

const logger = loggerService.withContext('ChatRecordCollector')

export const CHAT_ARCHIVE_NAMES = [
  'chats/topics.jsonl',
  'chats/messages.jsonl',
  'chats/agent-sessions.jsonl',
  'chats/agent-session-messages.jsonl'
] as const

type ChatArchiveName = (typeof CHAT_ARCHIVE_NAMES)[number]

export interface SerializedChatRecord {
  readonly archiveName: ChatArchiveName
  readonly bytes: number
  readonly data: Buffer
  readonly key: string
}

export interface ChatRecordCandidate {
  readonly id: string
  readonly kind: 'chatRecords'
  readonly latestAt: number
  readonly parts: readonly SerializedChatRecord[]
}

export interface ChatRecordCollection {
  readonly candidates: ChatRecordCandidate[]
  readonly warnings: Set<DiagnosticWarning>
}

function serializeRecord(archiveName: ChatArchiveName, key: string, entity: unknown): SerializedChatRecord {
  const data = Buffer.from(`${JSON.stringify(entity)}\n`, 'utf8')
  return { archiveName, bytes: data.length, data, key }
}

function collectNormalChatRecords(range: DiagnosticTimeRange): ChatRecordCandidate[] {
  const topics = new Map<string, unknown>()
  return messageService.listLiveCreatedInRange(range).map((message) => {
    let topic = topics.get(message.topicId)
    if (!topic) {
      topic = topicService.getById(message.topicId)
      topics.set(message.topicId, topic)
    }

    const messageRecord = serializeRecord('chats/messages.jsonl', `message:${message.id}`, message)
    const topicRecord = serializeRecord('chats/topics.jsonl', `topic:${message.topicId}`, topic)
    return {
      id: `message:${message.id}`,
      kind: 'chatRecords',
      latestAt: Date.parse(message.createdAt),
      parts: [messageRecord, topicRecord]
    }
  })
}

function collectAgentChatRecords(range: DiagnosticTimeRange): ChatRecordCandidate[] {
  const sessions = new Map<string, unknown>()
  return agentSessionMessageService.listCreatedInRange(range).map((message) => {
    let session = sessions.get(message.sessionId)
    if (!session) {
      session = agentSessionService.getById(message.sessionId)
      sessions.set(message.sessionId, session)
    }

    const messageRecord = serializeRecord(
      'chats/agent-session-messages.jsonl',
      `agent-session-message:${message.id}`,
      message
    )
    const sessionRecord = serializeRecord('chats/agent-sessions.jsonl', `agent-session:${message.sessionId}`, session)
    return {
      id: `agent-session-message:${message.id}`,
      kind: 'chatRecords',
      latestAt: Date.parse(message.createdAt),
      parts: [messageRecord, sessionRecord]
    }
  })
}

function warnUnreadableChatSource(
  warnings: Set<DiagnosticWarning>,
  source: 'normal-chat' | 'agent-session',
  error: unknown
): void {
  warnings.add('source_unreadable')
  logger.warn('Failed to collect diagnostic chat records', {
    errorName: error instanceof Error ? error.name : typeof error,
    source
  })
}

export function collectChatRecords(range: DiagnosticTimeRange): ChatRecordCollection {
  const warnings = new Set<DiagnosticWarning>()
  const candidates: ChatRecordCandidate[] = []

  try {
    candidates.push(...collectNormalChatRecords(range))
  } catch (error) {
    warnUnreadableChatSource(warnings, 'normal-chat', error)
  }

  try {
    candidates.push(...collectAgentChatRecords(range))
  } catch (error) {
    warnUnreadableChatSource(warnings, 'agent-session', error)
  }

  return { candidates, warnings }
}

function newestFirst(a: ChatRecordCandidate, b: ChatRecordCandidate): number {
  return b.latestAt - a.latestAt
}

export function chatRecordStats(candidates: readonly ChatRecordCandidate[]): ChatRecordStats {
  const records = new Map<string, SerializedChatRecord>()
  for (const candidate of candidates) {
    for (const part of candidate.parts) records.set(part.key, part)
  }
  return {
    bytes: [...records.values()].reduce((bytes, record) => bytes + record.bytes, 0),
    messageCount: candidates.length,
    recordCount: records.size
  }
}

export async function stageChatRecords(
  selectedCandidates: readonly ChatRecordCandidate[],
  tempRoot: AbsoluteFilePath
): Promise<StagedSource[]> {
  const recordsByArchiveName = new Map<ChatArchiveName, SerializedChatRecord[]>()
  const seenRecordKeys = new Set<string>()

  for (const candidate of [...selectedCandidates].sort(newestFirst)) {
    for (const record of candidate.parts) {
      if (seenRecordKeys.has(record.key)) continue
      seenRecordKeys.add(record.key)
      const records = recordsByArchiveName.get(record.archiveName) ?? []
      records.push(record)
      recordsByArchiveName.set(record.archiveName, records)
    }
  }

  await mkdir(path.join(tempRoot, 'chats'), { recursive: true })
  const staged: StagedSource[] = []
  for (const archiveName of CHAT_ARCHIVE_NAMES) {
    const records = recordsByArchiveName.get(archiveName)
    if (!records?.length) continue
    const data = Buffer.concat(records.map((record) => record.data))
    const destination = AbsoluteFilePathSchema.parse(path.join(tempRoot, archiveName))
    await writeFile(destination, data)
    staged.push({
      archiveName,
      bytes: data.length,
      kind: 'chatRecords',
      malformedLineCount: 0,
      path: destination
    })
  }
  return staged
}
