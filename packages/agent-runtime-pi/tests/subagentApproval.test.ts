import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort, ToolApprovalEvent } from '../src'
import {
  gate,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  subagentViews,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

/** The host's approval registry: one place every approval event goes through. */
function approvalHub() {
  const listeners = new Set<(event: ToolApprovalEvent) => void>()
  return {
    onApproval: (listener: (event: ToolApprovalEvent) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    emit: (event: ToolApprovalEvent) => {
      for (const listener of listeners) listener(event)
    },
    listening: () => listeners.size
  }
}

const risky = defineTool({
  name: 'risky',
  label: 'Risky',
  description: 'Needs approval',
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: 'text', text: 'done' }], details: undefined }
  }
})

describe('subagent approvals', () => {
  // Breaks when the parent and the host cannot see that a background subagent waits for the user
  // (Claude Code #99887: an unattended parent then waits all night), or it stays shown as waiting.
  it('shows a background subagent as awaiting approval while its call waits, then running again', async () => {
    const hub = approvalHub()
    const approved = gate()
    const approvalLayer: ExtensionFactory = (pi) => {
      pi.on('tool_call', async (event) => {
        hub.emit({ kind: 'pending', toolCallId: event.toolCallId })
        await approved.wait(undefined)
        hub.emit({ kind: 'granted', toolCallId: event.toolCallId })
        return undefined
      })
    }
    const recording = recordingSubagentPort(() => ({ extensionFactories: [approvalLayer] }))
    const port: SubagentPort = { ...recording.port, onApproval: hub.onApproval }
    const parent = hostStore()
    const { model } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [toolCallPart('risky_1', 'risky'), finish('tool-calls')]
          : reply('REPORT-A')
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Message B')
        return [toolCallPart('call_msg', 'message_subagent', { id: 'B', message: 'hi' }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [risky],
      subagents: port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await approved.reached

    await session.prompt('Message B')
    const { sessionId } = recording.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `No subagent with id B in this conversation. Subagents you can address:\n${sessionId} — Check A — waiting for a tool approval`
    )
    approved.open()
    await waitFor(() => subagentViews(parent.events).some((views) => views[0]?.status === 'finished'))

    expect(subagentViews(parent.events).map((views) => views[0].status)).toEqual([
      'running',
      'awaiting_approval',
      'running',
      'finished'
    ])
  })

  // Breaks when the parent's own approval shows a subagent as waiting because the subagent runs a
  // call of the same id: an event that names its session belongs to that session only.
  it("does not show a subagent waiting for the parent's approval under the same call id", async () => {
    const hub = approvalHub()
    const working = gate()
    const slow = defineTool({
      name: 'slow',
      label: 'Slow',
      description: 'Takes a while',
      parameters: Type.Object({}),
      execute: () => working.wait({ content: [{ type: 'text', text: 'slow done' }], details: undefined })
    })
    const parentApproval: ExtensionFactory = (pi) => {
      pi.on('tool_call', (event, ctx) => {
        const sessionId = ctx.sessionManager.getSessionId()
        hub.emit({ kind: 'pending', toolCallId: event.toolCallId, sessionId })
        hub.emit({ kind: 'granted', toolCallId: event.toolCallId, sessionId })
        return undefined
      })
    }
    const recording = recordingSubagentPort()
    const parent = hostStore()
    const { model } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('x_1', 'slow'), finish('tool-calls')] : reply('REPORT-A')
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Do the risky thing') return [toolCallPart('x_1', 'risky'), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [risky, slow],
      subagents: { ...recording.port, onApproval: hub.onApproval },
      extensionFactories: [parentApproval],
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await working.reached

    await session.prompt('Do the risky thing')
    working.open()
    await waitFor(() => subagentViews(parent.events).some((views) => views[0]?.status === 'finished'))

    expect(subagentViews(parent.events).map((views) => views[0].status)).toEqual(['running', 'finished'])
  })

  // Breaks when a fork takes the approval subscription meant for its parent, or the parent keeps it
  // after shutdown (the host would hold every listener).
  it('subscribes once per parent session and releases at shutdown', async () => {
    const hub = approvalHub()
    const recording = recordingSubagentPort()
    const port: SubagentPort = { ...recording.port, onApproval: hub.onApproval }
    let duringFork = 0
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) {
        duringFork = hub.listening()
        return reply('REPORT-A')
      }
      if (humanText === 'Fork A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A', fork: true }), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: port })
    await runtime.prompt('Fork A')
    expect(duringFork).toBe(1)

    await runtime.dispose()
    expect(hub.listening()).toBe(0)
  })
})
