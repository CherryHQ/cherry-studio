import { isToolUIPart } from 'ai'
import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { applyApprovalDecisions } from '../applyApprovalDecisions'
import type { ApprovalDecision } from '../stream'

type RequestedToolPart = Extract<CherryMessagePart, { state: 'approval-requested' }>

function toolPart(overrides: Partial<Pick<RequestedToolPart, 'toolCallId' | 'approval'>> = {}): RequestedToolPart {
  return {
    type: 'tool-fetch_url',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input: { url: 'https://example.com' },
    approval: { id: 'ap-1' },
    ...overrides
  }
}

const textPart: CherryMessagePart = { type: 'text', text: 'hello' }

function approvalState(part: CherryMessagePart) {
  if (!isToolUIPart(part)) throw new Error('Expected a tool invocation')
  return part
}

describe('applyApprovalDecisions', () => {
  it('flips a matching approval-requested part to approval-responded (approved)', () => {
    const decisions: ApprovalDecision[] = [{ approvalId: 'ap-1', approved: true }]
    const [part] = applyApprovalDecisions([toolPart()], decisions)
    const s = approvalState(part)

    expect(s.state).toBe('approval-responded')
    expect(s.approval).toEqual({ id: 'ap-1', approved: true })
  })

  it('carries the reason through on a denied decision', () => {
    const decisions: ApprovalDecision[] = [{ approvalId: 'ap-1', approved: false, reason: 'user denied' }]
    const [part] = applyApprovalDecisions([toolPart()], decisions)
    const s = approvalState(part)

    expect(s.state).toBe('approval-responded')
    expect(s.approval).toEqual({ id: 'ap-1', approved: false, reason: 'user denied' })
  })

  it('omits reason when the decision has none', () => {
    const [part] = applyApprovalDecisions([toolPart()], [{ approvalId: 'ap-1', approved: true }])
    expect('reason' in (approvalState(part).approval ?? {})).toBe(false)
  })

  it('ignores a decision whose approvalId matches no requested part', () => {
    const before = toolPart()
    const [part] = applyApprovalDecisions([before], [{ approvalId: 'other', approved: true }])
    expect(approvalState(part).state).toBe('approval-requested')
  })

  it('does not re-touch a part already in approval-responded', () => {
    const responded = {
      ...toolPart(),
      state: 'approval-responded',
      approval: { id: 'ap-1', approved: false }
    } satisfies CherryMessagePart
    const [part] = applyApprovalDecisions([responded], [{ approvalId: 'ap-1', approved: true }])
    // Still the original (denied) decision — already-settled parts are skipped.
    expect(approvalState(part).approval).toEqual({ id: 'ap-1', approved: false })
  })

  it('leaves non-tool parts untouched', () => {
    const [part] = applyApprovalDecisions([textPart], [{ approvalId: 'ap-1', approved: true }])
    expect(part).toEqual(textPart)
  })

  it('only flips the part whose approval id matches, among several', () => {
    const a = toolPart({ toolCallId: 'c-a', approval: { id: 'ap-a' } })
    const b = toolPart({ toolCallId: 'c-b', approval: { id: 'ap-b' } })
    const out = applyApprovalDecisions([a, b], [{ approvalId: 'ap-b', approved: true }])

    expect(approvalState(out[0]).state).toBe('approval-requested')
    expect(approvalState(out[1]).state).toBe('approval-responded')
  })

  it('preserves all parts when decisions are empty', () => {
    const input = [toolPart(), textPart]
    const out = applyApprovalDecisions(input, [])
    expect(out).toEqual(input)
  })

  it('stores updated tool input when applying an approval decision', () => {
    const parts: CherryMessagePart[] = [
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
    ]

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
