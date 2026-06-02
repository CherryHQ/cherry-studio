import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { applyApprovalDecisions } from '../applyApprovalDecisions'

describe('applyApprovalDecisions', () => {
  it('stores updated tool input when applying an approval decision', () => {
    const parts = [
      {
        type: 'tool-AskUserQuestion',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: {
          questions: [
            {
              question: 'Choose logger',
              header: 'Logger',
              options: [{ label: 'Winston' }]
            }
          ]
        },
        approval: { id: 'approval-1' }
      }
    ] as unknown as CherryMessagePart[]

    const updated = applyApprovalDecisions(parts, [
      {
        approvalId: 'approval-1',
        approved: true,
        updatedInput: {
          questions: [
            {
              question: 'Choose logger',
              header: 'Logger',
              options: [{ label: 'Winston' }]
            }
          ],
          answers: { 'Choose logger': 'Winston' }
        }
      }
    ])

    expect(updated[0]).toMatchObject({
      state: 'approval-responded',
      input: {
        answers: { 'Choose logger': 'Winston' }
      },
      approval: {
        id: 'approval-1',
        approved: true
      }
    })
  })
})
