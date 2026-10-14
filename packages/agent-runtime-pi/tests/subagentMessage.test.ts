import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  NOTE,
  recordingSubagentPort,
  reply,
  routedModel,
  subagentCall,
  subagentsDone,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }

describe('message_subagent to a running subagent', () => {
  // Breaks when the message is lost, interrupts the subagent's running tool, or reaches it before
  // the results of its current tool batch.
  it('reaches the subagent after its current tool batch', async () => {
    const toolGate = gate()
    const slow = defineTool({
      name: 'slow',
      label: 'Slow',
      description: 'Takes a while',
      parameters: Type.Object({}),
      execute: () => toolGate.wait({ content: [{ type: 'text', text: 'slow done' }], details: undefined })
    })
    const host = recordingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user' && lastText.includes('TASK-A')
          ? [toolCallPart('slow_1', 'slow'), finish('tool-calls')]
          : reply('REPORT-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Tell A to check C as well')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'ALSO-CHECK-C' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [slow],
      subagents: host.port
    })
    await session.prompt('Check A in the background')
    await toolGate.reached

    await session.prompt('Tell A to check C as well')
    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Message queued for subagent ${sessionId}; it reads it after its current step.`
    )
    toolGate.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const childCalls = calls.filter((call) => call.userText.includes('TASK-A'))
    expect(childCalls).toHaveLength(2)
    const last = childCalls[1].options.prompt.slice(-2)
    expect(last.map((message) => message.role)).toEqual(['tool', 'user'])
    expect(childCalls[1].lastText).toBe('ALSO-CHECK-C')
  })

  // Breaks when a message that arrives while the subagent settles is dropped, or the subagent is
  // reported finished before it has read it.
  it('keeps the subagent going when a message arrives while it settles', async () => {
    const settleGate = gate()
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        ((pi) => {
          let held = false
          pi.on('agent_before_settle', async () => {
            if (held) return undefined
            held = true
            await settleGate.wait(undefined)
            return undefined
          })
        }) satisfies ExtensionFactory
      ]
    }))
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'ALSO-CHECK-C' ? 'REPORT-A+C' : 'REPORT-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Tell A to check C as well')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'ALSO-CHECK-C' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await settleGate.reached

    await session.prompt('Tell A to check C as well')
    settleGate.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    expect(calls.filter((call) => call.userText.includes('TASK-A')).map((call) => call.lastText.slice(-12))).toEqual([
      expect.stringContaining('TASK-A'),
      'ALSO-CHECK-C'
    ])
    const finished = subagentStates(parent.entries).filter((state) => state.status === 'finished')
    expect(finished).toEqual([expect.objectContaining({ report: 'REPORT-A+C' })])
  })

  // Breaks when an unknown id is accepted, or the error leaves the model without the ids it can use.
  it('rejects an id this conversation never started and lists the ones it did', async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Message someone else')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: 'not-a-subagent', message: 'hi' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await session.prompt('Message someone else')

    const result = toolResultOf(session, 'call_msg')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `No subagent with id not-a-subagent in this conversation. Subagents you can address:\n${host.subagents[0].sessionId} — Check A — running`
    )
    held.open()
    await subagentsDone(session, parent.events)
  })

  // Breaks when a finished subagent is said to be messaged although nothing can continue it.
  it('refuses a finished subagent when the host cannot load its transcript', async () => {
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (lastText === 'Ask A again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'again' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Ask A again')

    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${host.subagents[0].sessionId} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
    )
  })
})
