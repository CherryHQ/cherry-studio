import type { AbsoluteFilePath } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

import type { ChatRecordCandidate } from '../chatRecordCollector'
import type { DiagnosticBudgetCandidate } from '../sourceSelection'
import {
  createDiagnosticBudgetSelector,
  selectBudgetCandidates,
  toChatBudgetCandidate,
  toFileBudgetCandidate
} from '../sourceSelection'
import type { SourceCandidate } from '../types'

function fileCandidate(
  kind: SourceCandidate['kind'],
  archiveName: string,
  eligibleBytes: number,
  latestAt: number
): SourceCandidate {
  return {
    archiveName,
    eligibleBytes,
    identity: { dev: 1, ino: latestAt, modifiedAt: latestAt, size: eligibleBytes },
    kind,
    latestAt,
    malformedLineCount: 0,
    sourcePath: `/tmp/${archiveName.replaceAll('/', '-')}` as AbsoluteFilePath
  }
}

function candidate(
  item: string,
  kind: DiagnosticBudgetCandidate<string>['kind'],
  latestAt: number,
  bytes: number
): DiagnosticBudgetCandidate<string> {
  return { item, key: item, kind, latestAt, parts: [{ key: item, bytes }] }
}

describe('diagnostic source budget selection', () => {
  it('keeps one newest file from each enabled source before filling the shared budget', () => {
    const mib = 1024 * 1024
    const newestLog = fileCandidate('logs', 'logs/new.jsonl', 30 * mib, 40)
    const newestTrace = fileCandidate('traces', 'traces/new.jsonl', 18 * mib, 30)
    const olderLog = fileCandidate('logs', 'logs/old.jsonl', 10 * mib, 20)

    const result = selectBudgetCandidates([olderLog, newestTrace, newestLog].map(toFileBudgetCandidate), 50 * mib)

    expect(result.selected).toEqual([newestLog, newestTrace])
    expect(result.omitted).toEqual([olderLog])
  })

  it('tries each source representative in global newest-first order when they cannot all fit', () => {
    const olderLog = candidate('log', 'logs', 10, 40)
    const newerTrace = candidate('trace', 'traces', 20, 30)
    const newestChat = candidate('chat', 'chatRecords', 30, 30)

    const result = selectBudgetCandidates([olderLog, newerTrace, newestChat], 60)

    expect(result.selected).toEqual([newestChat.item, newerTrace.item])
    expect(result.omitted).toEqual([olderLog.item])
  })

  it('counts a shared topic only once when selecting chat records', () => {
    const topic = { archiveName: 'chats/topics.jsonl', bytes: 10, data: Buffer.alloc(10), key: 'topic:1' } as const
    const older: ChatRecordCandidate = {
      id: 'message:older',
      kind: 'chatRecords',
      latestAt: 10,
      parts: [{ archiveName: 'chats/messages.jsonl', bytes: 5, data: Buffer.alloc(5), key: 'message:older' }, topic]
    }
    const newer: ChatRecordCandidate = {
      id: 'message:newer',
      kind: 'chatRecords',
      latestAt: 20,
      parts: [{ archiveName: 'chats/messages.jsonl', bytes: 5, data: Buffer.alloc(5), key: 'message:newer' }, topic]
    }

    const result = selectBudgetCandidates([older, newer].map(toChatBudgetCandidate), 20)

    expect(result.selected).toEqual([newer, older])
    expect(result.omitted).toEqual([])
  })

  it('reports only newly budgeted parts for incremental chat retention', () => {
    const topic = { archiveName: 'chats/topics.jsonl', bytes: 10, data: Buffer.alloc(10), key: 'topic:1' } as const
    const newer: ChatRecordCandidate = {
      id: 'message:newer',
      kind: 'chatRecords',
      latestAt: 20,
      parts: [{ archiveName: 'chats/messages.jsonl', bytes: 5, data: Buffer.alloc(5), key: 'message:newer' }, topic]
    }
    const older: ChatRecordCandidate = {
      id: 'message:older',
      kind: 'chatRecords',
      latestAt: 10,
      parts: [{ archiveName: 'chats/messages.jsonl', bytes: 5, data: Buffer.alloc(5), key: 'message:older' }, topic]
    }
    const selector = createDiagnosticBudgetSelector(20)

    expect(selector.trySelect(toChatBudgetCandidate(newer))).toEqual({
      selected: true,
      selectedPartKeys: ['message:newer', 'topic:1']
    })
    expect(selector.trySelect(toChatBudgetCandidate(older))).toEqual({
      selected: true,
      selectedPartKeys: ['message:older']
    })
  })

  it('fills remaining budget in global newest-first order across sources', () => {
    const newestLog = candidate('log-newest', 'logs', 100, 10)
    const newestTrace = candidate('trace-newest', 'traces', 90, 10)
    const newestChat = candidate('chat-newest', 'chatRecords', 80, 10)
    const laterTrace = candidate('trace-later', 'traces', 75, 10)
    const olderLog = candidate('log-older', 'logs', 70, 10)

    const result = selectBudgetCandidates([olderLog, laterTrace, newestChat, newestTrace, newestLog], 40)

    expect(result.selected).toEqual([newestLog.item, newestTrace.item, newestChat.item, laterTrace.item])
    expect(result.omitted).toEqual([olderLog.item])
  })

  it('omits a candidate that cannot fit without truncation', () => {
    const oversized = candidate('oversized', 'logs', 10, 21)

    const result = selectBudgetCandidates([oversized], 20)

    expect(result.selected).toEqual([])
    expect(result.omitted).toEqual([oversized.item])
  })

  it('uses the candidate key to break latest-time ties', () => {
    const laterKey = candidate('b', 'logs', 10, 5)
    const earlierKey = candidate('a', 'logs', 10, 5)

    const result = selectBudgetCandidates([laterKey, earlierKey], 5)

    expect(result.selected).toEqual([earlierKey.item])
    expect(result.omitted).toEqual([laterKey.item])
  })
})
