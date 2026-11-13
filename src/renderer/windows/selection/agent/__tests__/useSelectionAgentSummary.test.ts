import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { countTurnSteps, getSelectionAgentTurnStatus } from '../useSelectionAgentSummary'

const text = (value: string) => ({ type: 'text', text: value }) as CherryMessagePart
const tool = (toolCallId: string) =>
  ({ type: 'tool-read', toolCallId, state: 'output-available', input: {}, output: {} }) as CherryMessagePart
const message = (id: string, role: CherryUIMessage['role'], parts: CherryMessagePart[]) =>
  ({ id, role, parts }) as CherryUIMessage

describe('countTurnSteps', () => {
  it('counts the tool calls of the current turn only, including parts still streaming in', () => {
    const messages = [
      message('u1', 'user', [text('First')]),
      message('a1', 'assistant', [tool('old-1'), tool('old-2'), text('Done')]),
      message('u2', 'user', [text('Second')]),
      message('a2', 'assistant', [tool('t1')]),
      message('a3', 'assistant', [])
    ]

    expect(countTurnSteps(messages, { a3: [tool('t2'), text('Reading…'), tool('t3')] })).toBe(3)
  })

  it('has no steps before the agent answers', () => {
    expect(countTurnSteps([message('u1', 'user', [text('Hi')])], {})).toBe(0)
  })
})

describe('getSelectionAgentTurnStatus', () => {
  const idle = { turnSeen: true, status: undefined, awaitingApproval: false, needsInput: false }

  it('puts what waits on the user ahead of the stream state', () => {
    expect(getSelectionAgentTurnStatus({ ...idle, status: 'streaming', needsInput: true })).toBe('needs-input')
    // An MCP approval can outlive its stream, which already ended as done.
    expect(getSelectionAgentTurnStatus({ ...idle, status: 'done', awaitingApproval: true })).toBe('awaiting-approval')
  })

  it('is starting until the first turn shows up, then follows the stream', () => {
    expect(getSelectionAgentTurnStatus({ ...idle, turnSeen: false })).toBe('starting')
    expect(getSelectionAgentTurnStatus({ ...idle, status: 'pending' })).toBe('running')
    expect(getSelectionAgentTurnStatus({ ...idle, status: 'error' })).toBe('failed')
    expect(getSelectionAgentTurnStatus({ ...idle, status: 'aborted' })).toBe('done')
    // The stream entry is gone once the turn has settled.
    expect(getSelectionAgentTurnStatus(idle)).toBe('done')
  })
})
