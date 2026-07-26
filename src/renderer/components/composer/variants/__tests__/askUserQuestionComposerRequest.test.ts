import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { findLatestPendingAskUserQuestionRequest } from '../askUserQuestionComposerRequest'

const input = {
  questions: [
    {
      question: 'Choose logger',
      header: 'Logger',
      options: [{ label: 'Winston' }, { label: 'Pino' }],
      multiSelect: false
    }
  ]
}

function makePart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolName: 'AskUserQuestion',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input,
    approval: { id: 'approval-1' },
    providerExecuted: true,
    callProviderMetadata: { 'claude-code': { parentToolCallId: null } },
    ...overrides
  } as unknown as CherryMessagePart
}

describe('findLatestPendingAskUserQuestionRequest', () => {
  it('finds the latest pending AskUserQuestion request', () => {
    const result = findLatestPendingAskUserQuestionRequest({
      'message-1': [makePart()],
      'message-2': [makePart({ toolCallId: 'call-2', approval: { id: 'approval-2' } })]
    })

    expect(result).toMatchObject({
      messageId: 'message-2',
      toolCallId: 'call-2',
      approvalId: 'approval-2',
      input
    })
    expect(result?.match).toMatchObject({
      messageId: 'message-2',
      toolCallId: 'call-2',
      approvalId: 'approval-2',
      state: 'approval-requested'
    })
  })

  it('ignores invalid or already responded tool parts', () => {
    const result = findLatestPendingAskUserQuestionRequest({
      'message-1': [
        makePart({ toolName: 'Read' }),
        makePart({ state: 'approval-responded' }),
        makePart({ approval: undefined }),
        makePart({ input: { questions: [] } })
      ]
    })

    expect(result).toBeNull()
  })

  it('accepts AskUserQuestion input without multiSelect and defaults it to false', () => {
    const result = findLatestPendingAskUserQuestionRequest({
      'message-1': [
        makePart({
          input: {
            questions: [
              {
                question: 'Choose logger',
                header: 'Logger',
                options: [{ label: 'Winston' }, { label: 'Pino' }]
              }
            ]
          }
        })
      ]
    })

    expect(result?.input.questions[0]).toMatchObject({
      question: 'Choose logger',
      header: 'Logger',
      options: [{ label: 'Winston' }, { label: 'Pino' }],
      multiSelect: false
    })
  })

  it('accepts builtin AskUserQuestion tool names', () => {
    const result = findLatestPendingAskUserQuestionRequest({
      'message-1': [makePart({ toolName: 'builtin_AskUserQuestion', type: 'tool-builtin_AskUserQuestion' })]
    })

    expect(result).toMatchObject({
      messageId: 'message-1',
      toolCallId: 'call-1',
      approvalId: 'approval-1',
      input
    })
  })
})
