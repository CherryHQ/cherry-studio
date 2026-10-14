import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  NOTE,
  recordingSubagentPort,
  reply,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  untilStopped,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const BG_B = { description: 'Check B', prompt: 'TASK-B', background: true }
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))

describe('stopping subagents', () => {
  // Breaks when stop_subagent leaves the subagent running, loses its partial output, or is followed
  // by a notification that wakes the parent for a result it already has.
  it('stop_subagent stops a running subagent, returns its partial output and sends no notification', async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [...textParts('p', 'PARTIAL-A'), toolCallPart('work_1', 'work'), finish('tool-calls')]
          : reply('LATE-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: host.subagents[0].sessionId }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await work.reached

    // A notification would have been merged into this turn, or started as it settled.
    await session.prompt('Stop A')

    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_stop'))).toBe(
      `Stopped subagent ${sessionId}. Partial output before it stopped:\nPARTIAL-A`
    )
    expect(subagentStates(parent.entries).at(-1)).toMatchObject({
      status: 'finished',
      outcome: 'stopped',
      stoppedBy: 'model'
    })
    expect(notified(calls)).toEqual([])
  })

  // Breaks when stopping a finished subagent is an error the model has to recover from, or claims a
  // stop that did not happen.
  it('stop_subagent tells the model a finished subagent is not running', async () => {
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: host.subagents[0].sessionId }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Stop A')

    const result = toolResultOf(session, 'call_stop')
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe(`Subagent ${host.subagents[0].sessionId} is not running (completed).`)
  })

  // Breaks when the user's stop wakes the idle parent, the parent never hears of it, or the stop
  // button reports a stop that did not happen.
  it("the user's stop wakes nothing; the parent hears of it with the user's next message", async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A in the background')
    await work.reached
    const { sessionId } = host.subagents[0]

    expect(runtime.stopSubagent(sessionId)).toBe(true)
    await waitFor(() => subagentStates(parent.entries).some((state) => state.stoppedBy === 'user'))
    // A run the stop would start begins as the stop is recorded, so it would show by now.
    expect(runtime.session.isIdle).toBe(true)
    expect(notified(calls)).toEqual([])
    expect(runtime.stopSubagent(sessionId)).toBe(false)
    expect(runtime.stopSubagent('not-a-subagent')).toBe(false)

    await runtime.prompt('Any news?')
    const tail = calls.at(-1)!.options.prompt.slice(-2)
    expect(tail.map((message) => (message.role === 'user' ? message.content : message.role))).toEqual([
      [{ type: 'text', text: 'Any news?' }],
      [{ type: 'text', text: `${NOTE}\n\n- "Check A" (id: ${sessionId}) was stopped by the user.` }]
    ])
  })

  // Breaks when the user's stop during a prompt's turn costs that turn an extra request at its
  // settle, instead of riding with the user's next message.
  it("the user's stop during a turn rides with the next message, not the turn's settle", async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const runtime: { stopSubagent?: (id: string) => boolean } = {}
    const pressStop = defineTool({
      name: 'press_stop',
      label: 'Press stop',
      description: "The user presses a subagent's stop button",
      parameters: Type.Object({}),
      async execute() {
        runtime.stopSubagent!(host.subagents[0].sessionId)
        await waitFor(() => subagentStates(parent.entries).some((state) => state.stoppedBy === 'user'))
        return { content: [{ type: 'text', text: 'pressed' }], details: undefined }
      }
    })
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Do something') return [toolCallPart('press_1', 'press_stop'), finish('tool-calls')]
      return reply('OK.')
    })
    const created = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool, pressStop],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    runtime.stopSubagent = created.stopSubagent
    await created.prompt('Check A in the background')
    await work.reached
    const sent = calls.length
    await created.prompt('Do something')
    await created.prompt('Any news?')

    expect(
      calls
        .slice(sent)
        .map((call) => call.humanText || (call.lastText.startsWith(NOTE) ? 'notification' : call.lastRole))
    ).toEqual(['Do something', 'tool', 'Any news?'])
    expect(calls.at(-1)!.options.prompt.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: `${NOTE}\n\n- "Check A" (id: ${host.subagents[0].sessionId}) was stopped by the user.` }
      ]
    })
  })

  // Breaks when a quiet result is held back from a notification that goes out anyway.
  it("the user's stop rides with the next notification", async () => {
    const work = untilStopped()
    const heldB = gate()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE-A')
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A and B')
        return [subagentCall('call_a', BG_A), subagentCall('call_b', BG_B), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A and B')
    await work.reached
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId

    runtime.stopSubagent(id('Check A'))
    await waitFor(() => subagentStates(parent.entries).some((state) => state.stoppedBy === 'user'))
    heldB.open()
    await waitFor(() => notified(calls).length === 1)

    expect(notified(calls)[0].lastText).toBe(
      `${NOTE}\n\n- "Check A" (id: ${id('Check A')}) was stopped by the user.\n- "Check B" (id: ${id('Check B')}) completed:\n  REPORT-B`
    )
  })

  // Breaks when the host's background-task stop button can stop a foreground subagent mid-call.
  it("the user's stop does not reach a foreground subagent", async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const runtime: { stopSubagent?: (id: string) => boolean } = {}
    let stopped: boolean | undefined
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) {
        stopped = runtime.stopSubagent!(host.subagents[0].sessionId)
        return held.wait(reply('REPORT-A'))
      }
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      return reply('OK.')
    })
    const created = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    runtime.stopSubagent = created.stopSubagent
    const run = created.prompt('Check A')
    await held.reached
    held.open()
    await run

    expect(stopped).toBe(false)
    expect(textOf(toolResultOf(created.session, 'call_a'))).toMatch(/^REPORT-A/)
  })
})
