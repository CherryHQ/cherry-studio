import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  noteTool,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))

describe('moving a foreground subagent to the background', () => {
  // Breaks when moving re-runs the subagent from its prompt, leaves the parent's call waiting, lets
  // the parent's turn still stop it, or ends without a notification.
  it('returns the call at once and lets the same run go on, ending in a notification', async () => {
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
    const host = recordingSubagentPort()
    const store = hostStore()
    const { model, calls } = routedModel(({ userText, lastText, lastRole, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [toolCallPart('note_1', 'note'), finish('tool-calls')]
          : held.wait(reply('REPORT-A'))
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      // The same turn goes on after the moved call returns, and the user stops it.
      if (lastRole === 'tool' && toolResults(calls.at(-1)!).at(-1)?.toolCallId === 'call_a')
        return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool, stopTurn],
      subagents: host.port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    const turn = runtime.prompt('Check A')
    await held.reached
    const { sessionId } = host.subagents[0]

    expect(runtime.backgroundSubagent(sessionId)).toBe(true)
    await turn
    expect(store.events.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
    const result = toolResultOf(runtime.session, 'call_a')
    expect(textOf(result)).toBe(
      `The user moved this subagent to the background (id: ${sessionId}); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`
    )
    expect(result.details).toEqual({ sessionId, fork: false, background: true })

    held.open()
    await waitFor(() => subagentStates(store.entries).some((state) => state.status === 'finished'))
    expect(
      subagentStates(store.entries).map((state) => [state.run, state.status, state.background, state.outcome])
    ).toEqual([
      [1, 'running', true, undefined],
      [1, 'finished', true, 'completed']
    ])
    expect(calls.filter((call) => call.lastText.includes('TASK-A'))).toHaveLength(1)
    // The parent's turn was stopped, so the result rides with the user's next message.
    await runtime.prompt('And A?')
    expect(notified(calls).at(-1)!.lastText).toContain('REPORT-A')
  })

  // Breaks when a subagent that is not a running foreground one is taken over a second time.
  it('refuses a background, finished or unknown subagent', async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-BG')) return held.wait(reply('BG'))
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (humanText === 'Start both')
        return [
          subagentCall('call_bg', { description: 'BG', prompt: 'TASK-BG', background: true }),
          subagentCall('call_a', TASK_A),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await runtime.prompt('Start both')
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId

    expect(runtime.backgroundSubagent(id('BG'))).toBe(false)
    expect(runtime.backgroundSubagent(id('Check A'))).toBe(false)
    expect(runtime.backgroundSubagent('not-a-subagent')).toBe(false)
    held.open()
  })
})
