import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatRecordCandidate, ChatRecordCollection } from '../chatRecordCollector'
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
  const actual = await importOriginal<typeof import('../chatRecordCollector')>()
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
  return { candidates: [], records: new Map(), warnings: new Set() }
}

function chatCandidate(id: string, latestAt: number, parts: ChatRecordCandidate['parts']): ChatRecordCandidate {
  return { id, kind: 'chatRecords', latestAt, parts }
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
      data: Buffer.alloc(10),
      key: 'topic:1'
    } as const
    const candidates = [
      chatCandidate('message:1', 2, [
        { archiveName: 'chats/messages.jsonl', bytes: 5, data: Buffer.alloc(5), key: 'message:1' },
        topic
      ]),
      chatCandidate('message:2', 1, [
        { archiveName: 'chats/messages.jsonl', bytes: 7, data: Buffer.alloc(7), key: 'message:2' },
        topic
      ]),
      chatCandidate('agent-session-message:1', 0, [
        {
          archiveName: 'chats/agent-session-messages.jsonl',
          bytes: 11,
          data: Buffer.alloc(11),
          key: 'agent-session-message:1'
        },
        {
          archiveName: 'chats/agent-sessions.jsonl',
          bytes: 13,
          data: Buffer.alloc(13),
          key: 'agent-session:1'
        }
      ])
    ]
    sourceMocks.collectDiagnosticSources.mockResolvedValue(emptyCollection())
    chatMocks.collectChatRecords.mockReturnValue({
      candidates,
      records: new Map(),
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

  it('does not scan diagnostic sources concurrently while chat collection is in progress', async () => {
    let finishFirstChatScan: () => void = () => undefined
    sourceMocks.collectDiagnosticSources.mockResolvedValue(emptyCollection())
    chatMocks.collectChatRecords
      .mockImplementationOnce(
        () =>
          new Promise<ChatRecordCollection>((resolve) => {
            finishFirstChatScan = () => resolve(emptyChatCollection())
          }) as never
      )
      .mockReturnValueOnce(emptyChatCollection())
    const service = new DiagnosticBundleService()

    const firstInspection = service.inspect('24h')
    await vi.waitFor(() => expect(chatMocks.collectChatRecords).toHaveBeenCalledTimes(1))

    const secondInspection = service.inspect('3d')
    await Promise.resolve()
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(1)
    expect(chatMocks.collectChatRecords).toHaveBeenCalledTimes(1)

    finishFirstChatScan()
    await firstInspection
    await secondInspection
    expect(sourceMocks.collectDiagnosticSources).toHaveBeenCalledTimes(2)
    expect(chatMocks.collectChatRecords).toHaveBeenCalledTimes(2)
  })
})
