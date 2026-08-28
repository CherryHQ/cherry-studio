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
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
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

export type ChatArchiveName = (typeof CHAT_ARCHIVE_NAMES)[number]

export interface ChatRecordReference {
  readonly archiveName: ChatArchiveName
  readonly bytes: number
  readonly key: string
}

export interface ChatRecordCandidate {
  readonly contextId: string
  readonly contextRecord: ChatRecordReference
  readonly id: string
  readonly kind: 'chatRecords'
  readonly latestAt: number
  readonly messageId: string
  readonly messageRecord: ChatRecordReference
  readonly source: 'normal-chat' | 'agent-session'
}

export interface ChatRecordCollection {
  readonly candidates: AsyncIterable<ChatRecordCandidate>
  readonly warnings: Set<DiagnosticWarning>
}

interface HydratedChatRecord extends ChatRecordReference {
  readonly data: Buffer
}

export interface StagedChatRecords {
  readonly included: ChatRecordStats
  readonly observedByteDelta: number
  readonly sources: StagedSource[]
  readonly warnings: Set<DiagnosticWarning>
}

function recordReference(archiveName: ChatArchiveName, key: string, entityJsonBytes: number): ChatRecordReference {
  return { archiveName, bytes: entityJsonBytes + 1, key }
}

function contextRecord(archiveName: ChatArchiveName, key: string, entity: unknown): ChatRecordReference {
  return recordReference(archiveName, key, Buffer.byteLength(JSON.stringify(entity), 'utf8'))
}

function serializeRecord(reference: ChatRecordReference, entity: unknown): HydratedChatRecord {
  const data = Buffer.from(`${JSON.stringify(entity)}\n`, 'utf8')
  return { ...reference, bytes: data.length, data }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function* collectNormalChatRecords(
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): AsyncGenerator<ChatRecordCandidate> {
  let cursor: string | undefined
  const topics = new Map<string, ChatRecordReference>()
  try {
    do {
      const page = messageService.listLiveCreatedInRangeMetadataPage({
        ...range,
        cursor,
        limit: CHAT_RECORD_PAGE_SIZE
      })
      for (const message of page.items) {
        let topicReference = topics.get(message.topicId)
        if (!topicReference) {
          let topic
          try {
            topic = topicService.getById(message.topicId)
          } catch (error) {
            if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) throw error
            warnings.add('source_changed')
            logger.warn('Skipped diagnostic chat record with deleted topic', {
              source: 'normal-chat',
              topicId: message.topicId
            })
            continue
          }
          topicReference = contextRecord('chats/topics.jsonl', `topic:${message.topicId}`, topic)
          topics.set(message.topicId, topicReference)
        }

        yield {
          contextId: message.topicId,
          contextRecord: topicReference,
          id: `message:${message.id}`,
          kind: 'chatRecords',
          latestAt: Date.parse(message.createdAt),
          messageId: message.id,
          messageRecord: recordReference('chats/messages.jsonl', `message:${message.id}`, message.entityJsonBytes),
          source: 'normal-chat'
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
  const sessions = new Map<string, ChatRecordReference>()
  try {
    do {
      const page = agentSessionMessageService.listCreatedInRangeMetadataPage({
        ...range,
        cursor,
        limit: CHAT_RECORD_PAGE_SIZE
      })
      for (const message of page.items) {
        let sessionReference = sessions.get(message.sessionId)
        if (!sessionReference) {
          let session
          try {
            session = agentSessionService.getById(message.sessionId)
          } catch (error) {
            if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) throw error
            warnings.add('source_changed')
            logger.warn('Skipped diagnostic chat record with deleted agent session', {
              sessionId: message.sessionId,
              source: 'agent-session'
            })
            continue
          }
          sessionReference = contextRecord('chats/agent-sessions.jsonl', `agent-session:${message.sessionId}`, session)
          sessions.set(message.sessionId, sessionReference)
        }

        yield {
          contextId: message.sessionId,
          contextRecord: sessionReference,
          id: `agent-session-message:${message.id}`,
          kind: 'chatRecords',
          latestAt: Date.parse(message.createdAt),
          messageId: message.id,
          messageRecord: recordReference(
            'chats/agent-session-messages.jsonl',
            `agent-session-message:${message.id}`,
            message.entityJsonBytes
          ),
          source: 'agent-session'
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

export function addChatRecordStats(
  stats: ChatRecordStats,
  contextRecordKeys: Set<string>,
  candidate: ChatRecordCandidate
): void {
  stats.bytes += candidate.messageRecord.bytes
  stats.messageCount += 1
  stats.recordCount += 1
  if (contextRecordKeys.has(candidate.contextRecord.key)) return
  contextRecordKeys.add(candidate.contextRecord.key)
  stats.bytes += candidate.contextRecord.bytes
  stats.recordCount += 1
}

export async function scanChatRecordStats(candidates: AsyncIterable<ChatRecordCandidate>): Promise<ChatRecordStats> {
  const contextRecordKeys = new Set<string>()
  const stats: ChatRecordStats = { bytes: 0, messageCount: 0, recordCount: 0 }
  for await (const candidate of candidates) addChatRecordStats(stats, contextRecordKeys, candidate)
  return stats
}

function hydrateMessageRecord(candidate: ChatRecordCandidate): HydratedChatRecord {
  if (candidate.source === 'normal-chat') {
    return serializeRecord(candidate.messageRecord, messageService.getById(candidate.messageId))
  }

  return serializeRecord(
    candidate.messageRecord,
    agentSessionMessageService.getSessionMessage(candidate.contextId, candidate.messageId)
  )
}

function hydrateContextRecord(candidate: ChatRecordCandidate): HydratedChatRecord {
  if (candidate.source === 'normal-chat') {
    return serializeRecord(candidate.contextRecord, topicService.getById(candidate.contextId))
  }

  return serializeRecord(candidate.contextRecord, agentSessionService.getById(candidate.contextId))
}

export async function stageChatRecords(
  selectedCandidates: readonly ChatRecordCandidate[],
  tempRoot: AbsoluteFilePath,
  limitBytes: number
): Promise<StagedChatRecords> {
  const sortedCandidates = [...selectedCandidates].sort(newestFirst)
  await mkdir(path.join(tempRoot, 'chats'), { recursive: true })
  const destinations = new Map(
    CHAT_ARCHIVE_NAMES.map((archiveName) => [
      archiveName,
      AbsoluteFilePathSchema.parse(path.join(tempRoot, archiveName))
    ])
  )
  const writers = new Map<
    ChatArchiveName,
    {
      bytes: number
      completion: Promise<void>
      writer: ReturnType<typeof createAtomicWriteStream>
    }
  >()
  const included: ChatRecordStats = { bytes: 0, messageCount: 0, recordCount: 0 }
  const observedRecordKeys = new Set<string>()
  const stagedContextKeys = new Set<string>()
  const warnings = new Set<DiagnosticWarning>()
  let observedByteDelta = 0
  let remainingBytes = Math.max(0, limitBytes)

  const observeRecord = (record: HydratedChatRecord, reference: ChatRecordReference): void => {
    if (observedRecordKeys.has(record.key)) return
    observedRecordKeys.add(record.key)
    observedByteDelta += record.bytes - reference.bytes
    if (record.bytes !== reference.bytes) warnings.add('source_changed')
  }

  const writeRecord = async (record: HydratedChatRecord): Promise<void> => {
    let state = writers.get(record.archiveName)
    if (!state) {
      const writer = createAtomicWriteStream(destinations.get(record.archiveName)!)
      const completion = finished(writer)
      void completion.catch(() => undefined)
      state = { bytes: 0, completion, writer }
      writers.set(record.archiveName, state)
    }
    state.bytes += record.bytes
    if (!state.writer.write(record.data)) await once(state.writer, 'drain')
  }

  try {
    for (const candidate of sortedCandidates) {
      const includeContext = !stagedContextKeys.has(candidate.contextRecord.key)
      let messageRecord: HydratedChatRecord
      try {
        messageRecord = hydrateMessageRecord(candidate)
      } catch (error) {
        warnings.add(
          isDataApiError(error) && error.code === ErrorCode.NOT_FOUND ? 'source_changed' : 'source_unreadable'
        )
        logger.warn('Skipped a diagnostic chat record that could not be hydrated', {
          errorName: error instanceof Error ? error.name : typeof error,
          source: candidate.source
        })
        continue
      }

      observeRecord(messageRecord, candidate.messageRecord)
      if (messageRecord.bytes > remainingBytes) {
        warnings.add('size_limit_reached')
        continue
      }

      const records = [messageRecord]
      if (includeContext) {
        try {
          const contextRecord = hydrateContextRecord(candidate)
          observeRecord(contextRecord, candidate.contextRecord)
          records.push(contextRecord)
        } catch (error) {
          warnings.add(
            isDataApiError(error) && error.code === ErrorCode.NOT_FOUND ? 'source_changed' : 'source_unreadable'
          )
          logger.warn('Skipped a diagnostic chat context that could not be hydrated', {
            errorName: error instanceof Error ? error.name : typeof error,
            source: candidate.source
          })
          continue
        }
      }

      const candidateBytes = records.reduce((bytes, record) => bytes + record.bytes, 0)
      if (candidateBytes > remainingBytes) {
        warnings.add('size_limit_reached')
        continue
      }

      for (const record of records) await writeRecord(record)
      remainingBytes -= candidateBytes
      included.bytes += candidateBytes
      included.messageCount += 1
      included.recordCount += records.length
      if (includeContext) stagedContextKeys.add(candidate.contextRecord.key)
    }

    for (const { writer } of writers.values()) writer.end()
    await Promise.all([...writers.values()].map(({ completion }) => completion))
  } catch (error) {
    await Promise.allSettled(
      [...writers.values()].map(({ writer }) => (writer.destroyed ? Promise.resolve() : writer.abort()))
    )
    await Promise.allSettled([...destinations.values()].map((destination) => remove(destination)))
    throw error
  }

  const sources = CHAT_ARCHIVE_NAMES.flatMap((archiveName): StagedSource[] => {
    const state = writers.get(archiveName)
    return state
      ? [
          {
            archiveName,
            bytes: state.bytes,
            kind: 'chatRecords',
            malformedLineCount: 0,
            path: destinations.get(archiveName)!
          }
        ]
      : []
  })
  return { included, observedByteDelta, sources, warnings }
}
