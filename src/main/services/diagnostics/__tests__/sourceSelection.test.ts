import { describe, expect, it } from 'vitest'

import type { ChatRecordCandidate } from '../chatRecordCollector'
import { createDiagnosticBudgetSelector, toChatBudgetCandidate } from '../sourceSelection'

describe('diagnostic source budget selection', () => {
  it('reports only newly budgeted parts for incremental chat retention', () => {
    const topic = { archiveName: 'chats/topics.jsonl', bytes: 10, key: 'topic:1' } as const
    const newer: ChatRecordCandidate = {
      contextId: '1',
      contextRecord: topic,
      id: 'message:newer',
      kind: 'chatRecords',
      latestAt: 20,
      messageId: 'newer',
      messageRecord: { archiveName: 'chats/messages.jsonl', bytes: 5, key: 'message:newer' },
      source: 'normal-chat'
    }
    const older: ChatRecordCandidate = {
      contextId: '1',
      contextRecord: topic,
      id: 'message:older',
      kind: 'chatRecords',
      latestAt: 10,
      messageId: 'older',
      messageRecord: { archiveName: 'chats/messages.jsonl', bytes: 5, key: 'message:older' },
      source: 'normal-chat'
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
})
