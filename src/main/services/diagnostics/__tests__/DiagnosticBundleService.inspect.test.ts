import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatRecordCandidate, ChatRecordCollection, ChatRecordReference } from '../chatRecordCollector'
import type * as ChatRecordCollectorModule from '../chatRecordCollector'
import type * as SourceCollectorModule from '../sourceCollector'
import type { SourceCollection } from '../types'

const chatMocks = vi.hoisted(() => ({
  collectChatRecords: vi.fn()
}))

const sourceMocks = vi.hoisted(() => ({
  collectCrashDumpInventory: vi.fn(),
  collectDiagnosticSources: vi.fn()
}))

vi.mock('../chatRecordCollector', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatRecordCollectorModule>()
  return { ...actual, collectChatRecords: chatMocks.collectChatRecords }
})

vi.mock('../sourceCollector', async (importOriginal) => {
  const actual = await importOriginal<typeof SourceCollectorModule>()
  return {
    ...actual,
    collectCrashDumpInventory: sourceMocks.collectCrashDumpInventory,
    collectDiagnosticSources: sourceMocks.collectDiagnosticSources
  }
})

import { DiagnosticBundleService } from '../DiagnosticBundleService'

function emptyCollection(): SourceCollection {
  return { logs: [], traces: [], warnings: new Set() }
}

function emptyChatCollection(): ChatRecordCollection {
  return {
    candidates: (async function* () {})(),
    warnings: new Set()
  }
}

function chatCandidate(
  id: string,
  latestAt: number,
  [messageRecord, contextRecord]: [ChatRecordReference, ChatRecordReference]
): ChatRecordCandidate {
  const source = id.startsWith('agent-session-message:') ? 'agent-session' : 'normal-chat'
  return {
    contextId: contextRecord.key.slice(contextRecord.key.indexOf(':') + 1),
    contextRecord,
    id,
    kind: 'chatRecords',
    latestAt,
    messageId: id.slice(id.indexOf(':') + 1),
    messageRecord,
    source
  }
}

describe('DiagnosticBundleService inspection scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sourceMocks.collectCrashDumpInventory.mockResolvedValue({ files: [], totalBytes: 0 })
    chatMocks.collectChatRecords.mockReturnValue(emptyChatCollection())
  })

  it('reports unique chat-record bytes and message count with collection warnings', async () => {
    const topic = {
      archiveName: 'chats/topics.jsonl',
      bytes: 10,
      key: 'topic:1'
    } as const
    const candidates = [
      chatCandidate('message:1', 2, [{ archiveName: 'chats/messages.jsonl', bytes: 5, key: 'message:1' }, topic]),
      chatCandidate('message:2', 1, [{ archiveName: 'chats/messages.jsonl', bytes: 7, key: 'message:2' }, topic]),
      chatCandidate('agent-session-message:1', 0, [
        {
          archiveName: 'chats/agent-session-messages.jsonl',
          bytes: 11,
          key: 'agent-session-message:1'
        },
        {
          archiveName: 'chats/agent-sessions.jsonl',
          bytes: 13,
          key: 'agent-session:1'
        }
      ])
    ]
    sourceMocks.collectDiagnosticSources.mockResolvedValue(emptyCollection())
    chatMocks.collectChatRecords.mockReturnValue({
      candidates: (async function* () {
        yield* candidates
      })(),
      warnings: new Set(['source_unreadable'])
    })
    const service = new DiagnosticBundleService()

    await expect(service.inspect('24h')).resolves.toMatchObject({
      hasWarnings: true,
      sources: {
        chatRecords: { available: true, estimatedBytes: 46, messageCount: 3 }
      }
    })
  })

  it('does not scan diagnostic sources concurrently', async () => {
    let finishFirstSourceScan: () => void = () => undefined
    sourceMocks.collectDiagnosticSources
      .mockImplementationOnce(
        () =>
          new Promise<SourceCollection>((resolve) => {
            finishFirstSourceScan = () => resolve(emptyCollection())
          })
      )
      .mockResolvedValueOnce(emptyCollection())
    chatMocks.collectChatRecords.mockReturnValue(emptyChatCollection())
    const service = new DiagnosticBundleService()

    const firstInspection = service.inspect('24h')
    await vi.waitFor(() => expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(1))

    const secondInspection = service.inspect('3d')
    await Promise.resolve()
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(1)
    expect(chatMocks.collectChatRecords).not.toHaveBeenCalled()

    finishFirstSourceScan()
    await firstInspection
    await secondInspection
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(2)
    expect(chatMocks.collectChatRecords).toHaveBeenCalledTimes(2)
  })
})
