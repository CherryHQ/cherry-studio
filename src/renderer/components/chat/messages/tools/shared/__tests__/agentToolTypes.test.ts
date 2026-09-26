import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  buildAgentLaunchIndex,
  extractLaunchReceiptId,
  getResumedAgentId,
  resolveResumeReceiptState
} from '../agentToolTypes'

// Receipt shapes below are the ones the pinned dsh 0.1.2-rc.1 packages actually emit: a continuable
// launch acknowledges with `started subagent <childId>`, and a delivered message with
// `message delivered to agent <agent_id>` plus a `{ messageId }` payload that carries no identity.
describe('dsh receipt identities', () => {
  it('reads the child id from a continuable launch acknowledgement', () => {
    expect(extractLaunchReceiptId('started subagent dsh-child-1')).toBe('dsh-child-1')
  })

  it('leaves a background job acknowledgement alone — a job id is not a messageable child', () => {
    expect(extractLaunchReceiptId('started background subagent job job-1')).toBeUndefined()
  })

  it('does not read a phrase inside prose as a launch receipt', () => {
    expect(extractLaunchReceiptId('I started subagent dsh-child-1 earlier')).toBeUndefined()
  })

  it('reads a structured subagentId', () => {
    expect(extractLaunchReceiptId({ subagentId: 'dsh-child-1' })).toBe('dsh-child-1')
  })

  it('reads the woken child from a delivery acknowledgement', () => {
    expect(getResumedAgentId('message delivered to agent dsh-child-1')).toBe('dsh-child-1')
  })

  it('takes no identity from the structured delivery payload', () => {
    expect(getResumedAgentId({ messageId: 'msg-1' })).toBeUndefined()
  })

  it('does not read a failed delivery as a continuation', () => {
    expect(getResumedAgentId('the message was not delivered to agent dsh-child-1')).toBeUndefined()
  })

  it('resolves a dsh delivery receipt to the launch that started the child', () => {
    const launch: CherryMessagePart = {
      type: 'dynamic-tool',
      toolCallId: 'call-launch',
      toolName: 'subagent',
      state: 'output-available',
      input: { description: 'Audit the renderer' },
      output: 'started subagent dsh-child-1'
    }
    const launchIndex = buildAgentLaunchIndex({ m1: [launch] })

    expect(resolveResumeReceiptState('message delivered to agent dsh-child-1', undefined, launchIndex, true)).toEqual({
      kind: 'navigable',
      toolCallId: 'call-launch',
      description: 'Audit the renderer'
    })
  })
})
