import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { TranscriptEntry } from '../src'
import {
  gate,
  outputText,
  type RoutedCall,
  routedModel,
  storingSubagentPort,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, MODEL, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))
const message = (toolCallId: string, id: string, text: string) => [
  toolCallPart(toolCallId, 'message_subagent', { id, message: text }),
  finish('tool-calls')
]

describe('continuing a finished subagent', () => {
  // Breaks when a continuation starts from an empty context instead of the stored transcript, runs
  // in the foreground, sends no notification, or gives the host other settings than the first run.
  it('continues it in the background from its stored transcript and notifies the parent', async () => {
    const host = storingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'ALSO-CHECK-C' ? 'REPORT-C' : 'REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask A to check C') return message('call_msg', host.subagents[0].sessionId, 'ALSO-CHECK-C')
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A')
    await session.prompt('Ask A to check C')
    await waitFor(() => notified(calls).length === 1)

    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${sessionId} resumed in the background with your message; you will be notified when it finishes.`
    )
    const resumed = calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!
    expect(resumed.lastText).toBe('ALSO-CHECK-C')
    expect(resumed.options.prompt.some((entry) => JSON.stringify(entry).includes('REPORT-A'))).toBe(true)
    expect(host.subagents[1]).toEqual({
      parentToolCallId: 'call_a',
      continuedBy: 'call_msg',
      sessionId,
      description: 'Check A',
      fork: false,
      background: true,
      modelKey: MODEL.key
    })
    expect(subagentStates(parent.entries).map((state) => [state.run, state.status])).toEqual([
      [2, 'running'],
      [2, 'finished']
    ])
    expect(notified(calls)[0].lastText).toBe(`${NOTE}\n\n- "Check A" (id: ${sessionId}) completed:\n  REPORT-C`)
    const stored = host.transcripts.get(sessionId)!
    expect(stored.filter((entry) => entry.kind === 'state' && entry.type === 'cherry.subagent-origin')).toHaveLength(1)
    expect(new Set(stored.map((entry) => entry.id)).size).toBe(stored.length)
  })

  // Breaks when stop_subagent ends a subagent for good, or a subagent the user stopped can be revived.
  it('continues a subagent the model stopped but refuses one the user stopped', async () => {
    const work = gate()
    const workTool = defineTool({
      name: 'work',
      label: 'Work',
      description: 'Works until stopped',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void work.wait(undefined)
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped working' }], details: undefined }
      }
    })
    const host = storingSubagentPort()
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-')) {
        if (lastText === 'GO-ON') return reply('RESUMED')
        return lastText.includes('TASK-') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE')
      }
      // B's stop by the user rides with this prompt as a notification after it.
      if (humanText === 'Go on with A and B')
        return [
          toolCallPart('msg_a', 'message_subagent', { id: id('Check A'), message: 'GO-ON' }),
          toolCallPart('msg_b', 'message_subagent', { id: id('Check B'), message: 'GO-ON' }),
          finish('tool-calls')
        ]
      if (lastText === 'Start A and B')
        return [
          subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A', background: true }),
          subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B', background: true }),
          finish('tool-calls')
        ]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: id('Check A') }), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [workTool],
      subagents: host.port
    })
    await runtime.prompt('Start A and B')
    await work.reached
    await waitFor(
      () => calls.filter((call) => call.lastRole === 'user' && call.userText.includes('TASK-')).length === 2
    )
    await runtime.prompt('Stop A')
    expect(runtime.stopSubagent(id('Check B'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    await runtime.prompt('Go on with A and B')

    expect(textOf(toolResultOf(runtime.session, 'msg_a'))).toMatch(/^Subagent .* resumed in the background/)
    const refused = toolResultOf(runtime.session, 'msg_b')
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(
      `Subagent ${id('Check B')} was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.`
    )
    await waitFor(() => notified(calls).some((call) => call.lastText.includes('RESUMED')))
  })

  // Breaks when a call the interrupted run left open is left for Pi to answer as a plain failure,
  // when the answer is not stored by the host, or when the subagent gets no warning to check first.
  it('answers the calls an interrupted run left open and tells the subagent to check before going on', async () => {
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'work',
      label: 'Work',
      description: 'Works until the turn stops',
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
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Go on with A') return message('call_msg', host.subagents[0].sessionId, 'GO-ON')
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port
    })
    parent.session = runtime.session
    await runtime.prompt('Check A')
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
    // What the host holds when the app closed while `work` ran: the reply with the call, no result.
    const { sessionId } = host.subagents[0]
    const stored = host.transcripts.get(sessionId)!
    const cut = stored.findIndex((entry) => entry.kind === 'message' && entry.message.role === 'assistant')
    stored.splice(cut + 1)

    await runtime.prompt('Go on with A')
    await waitFor(() => notified(calls).length === 1)

    const resumed = calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!
    const [answer] = toolResults(resumed)
    expect(answer.toolCallId).toBe('work_1')
    expect(answer.output.type).toBe('error-text')
    expect(outputText(answer.output)).toBe(
      'This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.'
    )
    expect(resumed.lastText).toBe(
      'Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.\n\nGO-ON'
    )
    expect(
      stored.filter((entry: TranscriptEntry) => entry.kind === 'message' && entry.message.role === 'tool')
    ).toHaveLength(1)
  })

  // Breaks when one conversation can address another conversation's subagent by its id.
  it("refuses another conversation's subagent", async () => {
    const host = storingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask their A') return message('call_msg', host.subagents[0].sessionId, 'hello')
      return reply('OK.')
    })
    const first = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    const second = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await first.prompt('Check A')
    await second.prompt('Ask their A')

    expect(textOf(toolResultOf(second.session, 'call_msg'))).toBe(
      `No subagent with id ${host.subagents[0].sessionId} in this conversation.`
    )
  })

  // Breaks when a missing transcript lets a continuation start from nothing, or the failed
  // continuation keeps its background slot (review focus: the cap would fill with failures).
  it('fails when the host cannot load the transcript, and frees the slot', async () => {
    const host = storingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-')) return reply('REPORT')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask A again') return message('call_msg', host.subagents[0].sessionId, 'again')
      if (lastText === 'Check B in the background')
        return [
          subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B', background: true }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: { ...host.port, maxBackground: 1 }
    })
    await session.prompt('Check A')
    host.transcripts.delete(host.subagents[0].sessionId)
    await session.prompt('Ask A again')

    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${host.subagents[0].sessionId} cannot be continued: its transcript is not available.`
    )
    await session.prompt('Check B in the background')
    expect(textOf(toolResultOf(session, 'call_b'))).toMatch(/^Subagent started in the background/)
  })

  // Review focus 2. Breaks when two messages of one step to a finished subagent start two runs of
  // one session instead of one continuation that reads both.
  it('sends two messages of one step to a single continuation', async () => {
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A')) return reply(userText.includes('MSG-2') ? 'REPORT-BOTH' : 'REPORT-A')
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (humanText === 'Tell A two things') {
        const id = host.subagents[0].sessionId
        return [
          toolCallPart('msg_1', 'message_subagent', { id, message: 'MSG-1' }),
          toolCallPart('msg_2', 'message_subagent', { id, message: 'MSG-2' }),
          finish('tool-calls')
        ]
      }
      return reply(lastText.startsWith(NOTE) ? 'Read it.' : 'OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Tell A two things')
    await waitFor(() => notified(calls).length === 1)

    expect(host.subagents).toHaveLength(2)
    expect([textOf(toolResultOf(session, 'msg_1')), textOf(toolResultOf(session, 'msg_2'))]).toEqual([
      expect.stringMatching(/resumed in the background/),
      expect.stringMatching(/^Message queued for subagent/)
    ])
    expect(notified(calls)[0].lastText).toContain('REPORT-BOTH')
  })

  // Review focus 5. Breaks when a continuation still loading as the parent is disposed leaves its
  // subagent session running.
  it('leaves no subagent running when the parent is disposed during a continuation', async () => {
    let shutdowns = 0
    const loading = gate()
    const host = storingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const load = host.port.load!
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (humanText === 'Go on with A') return message('call_msg', host.subagents[0].sessionId, 'GO-ON')
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: { ...host.port, load: (id) => loading.wait(undefined).then(() => load(id)) }
    })
    await runtime.prompt('Check A')
    const turn = runtime.prompt('Go on with A')
    await loading.reached

    const disposed = runtime.dispose()
    loading.open()
    await disposed
    await turn.catch(() => undefined)

    expect(host.subagents).toHaveLength(2)
    expect(shutdowns).toBe(2)
  })
})
