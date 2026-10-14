import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { SUBAGENT_STATUS_TYPE } from '../src'
import {
  gate,
  type RoutedCall,
  routedModel,
  storingSubagentPort,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, plain, streamTextPort, tempDir, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const lastTwoTexts = (call: RoutedCall) =>
  call.options.prompt
    .slice(-2)
    .map((message) =>
      message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''
    )

describe('subagents after a rebuild', () => {
  // Breaks when a rebuilt parent still counts a dead run as running, starts a turn on its own, says
  // nothing of it, or says it again after every rebuild.
  it('reports a run the shutdown cut off as interrupted with the next user message, once', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A in the background')
    await held.reached
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await settle()
    expect(notified(calls)).toEqual([])
    await rebuilt.prompt('Where were we?')

    const { sessionId } = host.subagents[0]
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([
      'Where were we?',
      `${NOTE}\n\n- "Check A" (id: ${sessionId}) was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`
    ])

    const again = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain([...first.entries, ...second.entries])
    })
    await again.prompt('And now?')
    expect(lastTwoTexts(calls.at(-1)!)[1]).toBe('And now?')
  })

  // Breaks when an interrupted subagent cannot be continued after a rebuild, or continues without
  // the warning to check what its last run already did.
  it('continues an interrupted subagent after a rebuild with the recovery hint', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.startsWith('Your previous run') ? reply('REPORT-A') : held.wait(reply('LATE'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Go on with A')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'GO-ON' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A in the background')
    await held.reached
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await rebuilt.prompt('Go on with A')
    await waitFor(() => notified(calls).some((call) => call.lastText.includes('REPORT-A')))

    expect(textOf(toolResultOf(rebuilt.session, 'call_msg'))).toMatch(/resumed in the background/)
    expect(calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!.lastText).toMatch(
      /^Your previous run was interrupted\.[\s\S]*\n\nGO-ON$/
    )
    expect(subagentStates(second.entries).map((state) => [state.run, state.status])).toEqual([
      [2, 'running'],
      [2, 'finished']
    ])
  })

  // Breaks when a result that never reached the parent is lost with the session, or delivered twice.
  it('delivers a result that never reached the parent with the next user message, once', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'stop_turn',
      label: 'Stop turn',
      description: 'The user presses stop',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      onEvent: first.onEvent
    })
    parent.session = before.session
    await before.prompt('Check A in the background')
    // The user stopped a turn, so the result waits for their next message, which never comes.
    await before.prompt('Do something long')
    held.open()
    await waitFor(() => subagentStates(first.entries).some((state) => state.status === 'finished'))
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await rebuilt.prompt('Where were we?')
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([
      'Where were we?',
      `${NOTE}\n\n- "Check A" (id: ${host.subagents[0].sessionId}) completed:\n  REPORT-A`
    ])

    const again = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      transcript: plain([...first.entries, ...second.entries])
    })
    await again.prompt('And now?')
    expect(lastTwoTexts(calls.at(-1)!)[1]).toBe('And now?')
  })

  // Breaks when a foreground subagent of an earlier session cannot be addressed after a rebuild:
  // its tool result is the only record of it.
  it('continues a foreground subagent of the session before the rebuild', async () => {
    const cwd = tempDir('cwd')
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'AGAIN' ? 'REPORT-2' : 'REPORT-1')
      if (humanText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (humanText === 'Ask A again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'AGAIN' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A')
    await before.dispose()

    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries)
    })
    await rebuilt.prompt('Ask A again')

    await waitFor(() => notified(calls).some((call) => call.lastText.includes('REPORT-2')))
  })
})

describe('subagent status after a compaction', () => {
  // Breaks when the compacted context no longer tells the model its subagent is running, so it
  // starts it again.
  it('lists the running background subagents after a compaction', async () => {
    const held = gate()
    const parent = hostStore()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1, summarize: async () => 'SUMMARY' }
    })
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Anything else?')

    await runtime.compact()
    await runtime.prompt('What is running?')

    const status = `Background subagent status (automatic message, not from the user):\n- "Check A" (id: ${host.subagents[0].sessionId}): running\nRunning subagents report back on their own when they finish: do not start them again, and do not wait for or poll them.`
    const kinds = parent.entries.map((entry) =>
      entry.kind === 'message' ? (entry.custom?.type ?? entry.message.role) : entry.kind
    )
    expect(kinds.slice(kinds.indexOf('compaction'), kinds.indexOf('compaction') + 2)).toEqual([
      'compaction',
      SUBAGENT_STATUS_TYPE
    ])
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([status, 'What is running?'])
    held.open()
  })
})
