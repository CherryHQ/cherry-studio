import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { createAtomicWriteStream, remove } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import type { ChatRecordStats, DiagnosticTimeRange, DiagnosticWarning, StagedSource } from './types'

const logger = loggerService.withContext('ChatRecordCollector')
const CHAT_RECORD_PAGE_SIZE = 100

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
  readonly candidates: AsyncIterable<ChatRecordCandidate>
  readonly warnings: Set<DiagnosticWarning>
}

function serializeRecord(archiveName: ChatArchiveName, key: string, entity: unknown): SerializedChatRecord {
  const data = Buffer.from(`${JSON.stringify(entity)}\n`, 'utf8')
  return { archiveName, bytes: data.length, data, key }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function* collectNormalChatRecords(
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): AsyncGenerator<ChatRecordCandidate> {
  let cursor: string | undefined
  try {
    do {
      const page = messageService.listLiveCreatedInRangePage({ ...range, cursor, limit: CHAT_RECORD_PAGE_SIZE })
      const topics = new Map<string, SerializedChatRecord>()
      for (const message of page.items) {
        let topicRecord = topics.get(message.topicId)
        if (!topicRecord) {
          const topic = topicService.getById(message.topicId)
          topicRecord = serializeRecord('chats/topics.jsonl', `topic:${message.topicId}`, topic)
          topics.set(message.topicId, topicRecord)
        }

        yield {
          id: `message:${message.id}`,
          kind: 'chatRecords',
          latestAt: Date.parse(message.createdAt),
          parts: [serializeRecord('chats/messages.jsonl', `message:${message.id}`, message), topicRecord]
        }
      }
      cursor = page.nextCursor
      if (cursor) await yieldToEventLoop()
    } while (cursor)
  } catch (error) {
    warnUnreadableChatSource(warnings, 'normal-chat', error)
  }
}

async function* collectAgentChatRecords(
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): AsyncGenerator<ChatRecordCandidate> {
  let cursor: string | undefined
  try {
    do {
      const page = agentSessionMessageService.listCreatedInRangePage({ ...range, cursor, limit: CHAT_RECORD_PAGE_SIZE })
      const sessions = new Map<string, SerializedChatRecord>()
      for (const message of page.items) {
        let sessionRecord = sessions.get(message.sessionId)
        if (!sessionRecord) {
          const session = agentSessionService.getById(message.sessionId)
          sessionRecord = serializeRecord('chats/agent-sessions.jsonl', `agent-session:${message.sessionId}`, session)
          sessions.set(message.sessionId, sessionRecord)
        }

        yield {
          id: `agent-session-message:${message.id}`,
          kind: 'chatRecords',
          latestAt: Date.parse(message.createdAt),
          parts: [
            serializeRecord('chats/agent-session-messages.jsonl', `agent-session-message:${message.id}`, message),
            sessionRecord
          ]
        }
      }
      cursor = page.nextCursor
      if (cursor) await yieldToEventLoop()
    } while (cursor)
  } catch (error) {
    warnUnreadableChatSource(warnings, 'agent-session', error)
  }
}

function newestFirst(a: ChatRecordCandidate, b: ChatRecordCandidate): number {
  return b.latestAt - a.latestAt || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0)
}

async function* mergeNewestFirst(
  normal: AsyncIterator<ChatRecordCandidate>,
  agent: AsyncIterator<ChatRecordCandidate>
): AsyncGenerator<ChatRecordCandidate> {
  let normalResult = await normal.next()
  let agentResult = await agent.next()
  while (!normalResult.done || !agentResult.done) {
    if (agentResult.done || (!normalResult.done && newestFirst(normalResult.value, agentResult.value) <= 0)) {
      yield normalResult.value
      normalResult = await normal.next()
    } else {
      yield agentResult.value
      agentResult = await agent.next()
    }
  }
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
  const candidates = mergeNewestFirst(
    collectNormalChatRecords(range, warnings),
    collectAgentChatRecords(range, warnings)
  )
  return { candidates, warnings }
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

export async function scanChatRecordStats(candidates: AsyncIterable<ChatRecordCandidate>): Promise<ChatRecordStats> {
  const recordKeys = new Set<string>()
  const stats: ChatRecordStats = { bytes: 0, messageCount: 0, recordCount: 0 }
  for await (const candidate of candidates) {
    stats.messageCount += 1
    for (const part of candidate.parts) {
      if (recordKeys.has(part.key)) continue
      recordKeys.add(part.key)
      stats.bytes += part.bytes
      stats.recordCount += 1
    }
  }
  return stats
}

export async function stageChatRecords(
  selectedCandidates: readonly ChatRecordCandidate[],
  tempRoot: AbsoluteFilePath
): Promise<StagedSource[]> {
  const sortedCandidates = [...selectedCandidates].sort(newestFirst)
  const seenRecordKeys = new Set<string>()
  await mkdir(path.join(tempRoot, 'chats'), { recursive: true })
  const staged: StagedSource[] = []
  for (const archiveName of CHAT_ARCHIVE_NAMES) {
    const destination = AbsoluteFilePathSchema.parse(path.join(tempRoot, archiveName))
    let writer: ReturnType<typeof createAtomicWriteStream> | undefined
    let completion: Promise<void> | undefined
    let bytes = 0
    try {
      for (const candidate of sortedCandidates) {
        for (const record of candidate.parts) {
          if (record.archiveName !== archiveName || seenRecordKeys.has(record.key)) continue
          if (!writer) {
            writer = createAtomicWriteStream(destination)
            completion = finished(writer)
            void completion.catch(() => undefined)
          }
          seenRecordKeys.add(record.key)
          bytes += record.bytes
          if (!writer.write(record.data)) await once(writer, 'drain')
        }
      }
      if (!writer || !completion) continue
      writer.end()
      await completion
      staged.push({ archiveName, bytes, kind: 'chatRecords', malformedLineCount: 0, path: destination })
    } catch (error) {
      if (writer && !writer.destroyed) await writer.abort().catch(() => undefined)
      await remove(destination).catch(() => undefined)
      throw error
    }
  }
  return staged
}
