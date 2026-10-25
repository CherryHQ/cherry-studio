import { describe, expect, it } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentLaunchIndex } from '../../shared/agentToolTypes'
import { resolveAgentToolFlowTarget } from '../agentToolFlowTarget'

function launchPart(): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'call_launch',
    toolName: 'Agent',
    state: 'output-available',
    input: { prompt: 'Launch the review' },
    output: { status: 'async_launched', taskId: 'task-77' }
  } as unknown as CherryMessagePart
}

function toolResponse(name: string, toolCallId: string, response: unknown): NormalToolResponse {
  return {
    id: `response-${toolCallId}`,
    toolCallId,
    tool: { id: name, name, type: 'provider' },
    arguments: {},
    response,
    status: 'done'
  } as unknown as NormalToolResponse
}

describe('resolveAgentToolFlowTarget', () => {
  const launchIndex = buildAgentLaunchIndex({ m1: [launchPart()] })

  // Only a SendMessage result continues an agent: a foreground Agent report may carry an agent id
  // of its own, and following it would open an unrelated flow.
  it('keeps an ordinary Agent report on its own flow', () => {
    const response = toolResponse('Agent', 'call_report', { pin: { id: 'task-77' }, findings: ['All good'] })

    expect(resolveAgentToolFlowTarget(response, launchIndex, true)).toBe('call_report')
  })

  it('still follows a SendMessage receipt to the launch root', () => {
    const response = toolResponse('SendMessage', 'call_send', { pin: { id: 'task-77' } })

    expect(resolveAgentToolFlowTarget(response, launchIndex, true)).toBe('call_launch')
  })
})
