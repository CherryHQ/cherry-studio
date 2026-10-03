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

  it('does not read an embedded marker line as a launch receipt', () => {
    // A child's own multi-line answer may quote the phrase; only the whole output is a receipt.
    expect(
      extractLaunchReceiptId('Here is what I ran.\nstarted subagent dsh-child-1\nHope that helps.')
    ).toBeUndefined()
  })

  it('does not read an embedded delivery line as a continuation', () => {
    expect(getResumedAgentId('transcript follows:\nmessage delivered to agent dsh-child-1')).toBeUndefined()
  })

  it('indexes a persisted static tool part, which carries its name in the part type', () => {
    const staticLaunch = {
      type: 'tool-Agent',
      toolCallId: 'call-launch',
      state: 'output-available',
      input: { description: 'Audit the renderer' },
      output: 'started subagent dsh-child-1'
    } as unknown as CherryMessagePart

    const launchIndex = buildAgentLaunchIndex({ m1: [staticLaunch] })
    expect(launchIndex.toolCallIds.has('call-launch')).toBe(true)
    expect(launchIndex.launchesByAgentId.get('dsh-child-1')?.toolCallId).toBe('call-launch')
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

  it('takes no identity from prose that quotes a receipt-shaped fragment', () => {
    // A child's own answer can quote a receipt it saw; only a whole JSON output is a receipt.
    expect(
      getResumedAgentId('The child wrote {"success":true,"resumedAgentId":"agent-77"} in its report.')
    ).toBeUndefined()
    expect(getResumedAgentId('Example: {"pin":{"id":"agent-77"}}')).toBeUndefined()
    expect(getResumedAgentId('It reported {"subagent_id":"dsh-child-1"} to the parent.')).toBeUndefined()
  })

  it('reads an id as an id, not as whatever follows the space', () => {
    // The ack grammar is the whole line, so a punctuated one simply does not register — it must not
    // yield a target with the punctuation stuck to it.
    expect(getResumedAgentId('message delivered to agent dsh-child-1.')).toBeUndefined()
    expect(extractLaunchReceiptId('started subagent dsh-child-1.')).toBeUndefined()
  })

  it('binds a launch id only where the receipt actually names it', () => {
    // A foreground launch's result is the child's own answer, so prose that starts with the launch
    // prefix and later quotes an id must not bind the flow to that id.
    expect(
      extractLaunchReceiptId('done. Here is my report. The agentId: spoofed-id was mentioned earlier.')
    ).toBeUndefined()
    expect(
      extractLaunchReceiptId('done.\nHere is my report. The agentId: spoofed-id was mentioned earlier.')
    ).toBeUndefined()
  })

  it('reads a receipt delivered as JSON text', () => {
    expect(getResumedAgentId('{"success":true,"resumedAgentId":"agent-77"}')).toBe('agent-77')
  })

  it('takes no launch identity from prose that quotes a launch instruction', () => {
    const quoted =
      "To continue an agent, call Use SendMessage with to: 'agent-77'. Its receipt shows agentId: agent-77."
    expect(extractLaunchReceiptId(quoted)).toBeUndefined()
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

  it('labels a receipt from the same launch it targets when the stamp disagrees', () => {
    const parts = {
      m1: [launchPart('call-a', 'agent-a', 'Audit the renderer'), launchPart('call-b', 'agent-b', 'Review the patch')]
    }
    const launchIndex = buildAgentLaunchIndex(parts)

    // A stale stamp must not pair agent b's identity with agent a's flow.
    expect(resolveResumeReceiptState('{"resumedAgentId":"agent-b"}', 'call-a', launchIndex, true)).toEqual({
      kind: 'navigable',
      toolCallId: 'call-a',
      description: 'Audit the renderer'
    })
  })

  it('takes a dsh task edge from the live cache as a flow root', () => {
    const parts = { m1: [dshSendMessagePart('call-send')] }
    const liveEdge = {
      'dsh-child-1': {
        event: 'started',
        taskId: 'dsh-child-1',
        toolUseId: 'call-send',
        status: 'in_progress'
      }
    } as const

    expect([...buildAgentLaunchIndex(parts, liveEdge).dshTaskRootCallIds]).toEqual(['call-send'])
    // The binding only lives in the cache here, so the loaded parts alone say nothing.
    expect(buildAgentLaunchIndex(parts).dshTaskRootCallIds.size).toBe(0)
  })

  it('keeps a send that has not returned yet out of the flow entries', () => {
    // Nothing has resumed while the call is in flight, so the row must stay plain rather than
    // offering a flow whose content cannot exist yet.
    const launchIndex = buildAgentLaunchIndex({ m1: [launchPart('call-a', 'agent-a', 'Audit the renderer')] })

    expect(resolveResumeReceiptState(undefined, undefined, launchIndex, true)).toEqual({ kind: 'none' })
    expect(resolveResumeReceiptState(undefined, 'call-a', launchIndex, true)).toEqual({ kind: 'none' })
  })

  it('keeps a deferred receipt as the flow that can hydrate its own answer', () => {
    // The pane hydrates the selected call's deferred result, so a receipt whose result is still an
    // envelope has to stay selected: stamping it onto the launch root would strand its answer.
    const launchIndex = buildAgentLaunchIndex({ m1: [launchPart('call-a', 'agent-a', 'Audit the renderer')] })

    expect(
      resolveResumeReceiptState(
        { $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'call-send' } },
        'call-a',
        launchIndex,
        true
      )
    ).toEqual({ kind: 'self' })
  })
})

function dshSendMessagePart(toolCallId: string): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName: 'send_message',
    state: 'output-available',
    input: { agent_id: 'dsh-child-1' },
    output: 'message delivered to agent dsh-child-1',
    callProviderMetadata: { cherry: { transport: 'dsh-agent' } }
  } as unknown as CherryMessagePart
}

function launchPart(toolCallId: string, agentId: string, description: string): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName: 'Agent',
    state: 'output-available',
    input: { description, prompt: description },
    output: `done. agentId: ${agentId} (internal metadata. Use SendMessage with to: '${agentId}')`
  } as unknown as CherryMessagePart
}
