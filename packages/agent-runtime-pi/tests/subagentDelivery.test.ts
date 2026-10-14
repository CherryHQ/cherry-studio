import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { SUBAGENT_NOTIFICATION_TYPE, type ToolOutputStore, type TranscriptEntry } from '../src'
import {
  gate,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const BG_B = { description: 'Check B', prompt: 'TASK-B', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

/** The parent's requests: a subagent's carry its task. */
const parentCalls = (calls: readonly RoutedCall[]) => calls.filter((call) => !call.userText.includes('TASK-'))
const notifications = (entries: readonly TranscriptEntry[]) =>
  entries.filter((entry) => entry.kind === 'message' && entry.custom?.type === SUBAGENT_NOTIFICATION_TYPE)
const finishedCount = (entries: readonly TranscriptEntry[]) =>
  subagentStates(entries).filter((state) => state.status === 'finished').length

/** A tool that runs `body` while the parent's turn waits on it. */
const waitingTool = (body: () => Promise<void>) =>
  defineTool({
    name: 'wait_here',
    label: 'Wait',
    description: 'Waits',
    parameters: Type.Object({}),
    async execute() {
      await body()
      return { content: [{ type: 'text', text: 'waited' }], details: undefined }
    }
  })

describe('background subagent delivery', () => {
  // Breaks when an idle parent is not woken, or the result reaches the transcript as a user message
  // (the host would render it as the user's bubble) or without its structured details.
  it('wakes the idle parent with a notification message once the subagent finishes', async () => {
    const held = gate()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Launched.')
    })
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A in the background')
    held.open()
    await waitFor(() => parent.events.filter((event) => event.type === 'turn-complete').length === 2)

    const { sessionId } = host.subagents[0]
    expect(calls.at(-1)!.lastRole).toBe('user')
    expect(calls.at(-1)!.lastText).toBe(`${NOTE}\n\n- "Check A" (id: ${sessionId}) completed:\n  REPORT-A`)
    expect(notifications(parent.entries)).toEqual([
      expect.objectContaining({
        message: { role: 'user', content: calls.at(-1)!.lastText },
        custom: {
          type: SUBAGENT_NOTIFICATION_TYPE,
          display: false,
          details: {
            subagents: [
              { sessionId, run: 1, outcome: 'completed', usage: expect.objectContaining({ totalTokens: 17 }) }
            ]
          }
        }
      })
    ])
  })

  // Breaks when the notification is steered into the running turn (it would reach a mid-turn
  // request) or opens a run of its own instead of continuing the one that settles.
  it('merges a result that arrives during a turn into that turn as it settles', async () => {
    const held = gate()
    const parent = hostStore()
    const waitHere = waitingTool(async () => {
      held.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A and keep working')
        return [subagentCall('call_a', BG_A), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      if (lastRole === 'tool') return reply('Kept working.')
      return reply('Read the report.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A and keep working')

    expect(parentCalls(calls).map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastRole))).toEqual(
      ['user', 'tool', 'notification']
    )
    expect(parent.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
  })

  // Breaks when the notification is delivered ahead of a message the user queued during the turn.
  it("answers the user's queued message before the result", async () => {
    const held = gate()
    const parent = hostStore()
    const runtime: { prompt?: (text: string, options?: { streamingBehavior: 'followUp' }) => Promise<void> } = {}
    const waitHere = waitingTool(async () => {
      held.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
      await runtime.prompt!('USER-FOLLOW-UP', { streamingBehavior: 'followUp' })
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A and keep working')
        return [subagentCall('call_a', BG_A), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      return reply(lastRole === 'tool' ? 'Kept working.' : 'Answered.')
    })
    const created = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })
    runtime.prompt = created.prompt

    await created.prompt('Check A and keep working')

    expect(
      parentCalls(calls)
        .slice(2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['USER-FOLLOW-UP', 'notification'])
  })

  // Breaks when every result opens its own round instead of one notification for all.
  it('sends the results that arrive during one turn as one notification, in the order they finished', async () => {
    const heldA = gate()
    const heldB = gate()
    const parent = hostStore()
    const waitHere = waitingTool(async () => {
      heldA.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
      heldB.open()
      await waitFor(() => finishedCount(parent.entries) === 2)
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply('REPORT-A'))
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A and B')
        return [
          subagentCall('call_b', BG_B),
          subagentCall('call_a', BG_A),
          toolCallPart('wait_1', 'wait_here'),
          finish('tool-calls')
        ]
      return reply(lastRole === 'tool' ? 'Kept working.' : 'Read both.')
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A and B')

    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId
    expect(calls.filter((call) => call.lastText.startsWith(NOTE)).map((call) => call.lastText)).toEqual([
      `${NOTE}\n\n- "Check A" (id: ${id('Check A')}) completed:\n  REPORT-A\n- "Check B" (id: ${id('Check B')}) completed:\n  REPORT-B`
    ])
    expect(notifications(parent.entries)).toHaveLength(1)
  })

  // Breaks when a notification starts a run while the host compacts, or nothing delivers it once
  // the compaction returns.
  it('waits for a manual compaction to end before starting the notification run', async () => {
    const held = gate()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Noted.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent,
      compaction: {
        reserveTokens: 16_384,
        keepRecentTokens: 1,
        summarize: async () => {
          held.open()
          await waitFor(() => finishedCount(parent.entries) === 1)
          return 'SUMMARY'
        }
      }
    })
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Anything else?')

    await runtime.compact()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const order = parent.events.flatMap((event) =>
      event.type === 'compaction-end'
        ? ['compaction-end']
        : event.type === 'transcript-append' && notifications(event.entries).length > 0
          ? ['notification']
          : []
    )
    expect(order).toEqual(['compaction-end', 'notification'])
  })

  // Breaks when a result arriving while the host's prompt prepares starts a run of its own: Pi then
  // rejects the prompt ("Agent is already processing") and the user's message is lost.
  it("delivers a result that arrives while the host's prompt prepares after that prompt's turn", async () => {
    const held = gate()
    const parent = hostStore()
    let holdNextPrompt = false
    const slowStart: ExtensionFactory = (pi) => {
      pi.on('before_agent_start', async () => {
        if (!holdNextPrompt) return undefined
        holdNextPrompt = false
        held.open()
        await waitFor(() => finishedCount(parent.entries) === 1)
        return undefined
      })
    }
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Answered.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      extensionFactories: [slowStart],
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A in the background')

    holdNextPrompt = true
    await runtime.prompt('Second question')

    expect(
      parentCalls(calls)
        .slice(-2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['Second question', 'notification'])
  })

  // Breaks when stopping a turn is followed by an automatic run, when the result is lost, or when
  // automatic runs never come back after the user speaks again.
  it('starts nothing after the user stops a turn; the result rides with their next message', async () => {
    const heldA = gate()
    const heldB = gate()
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
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply('REPORT-A'))
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Check B in the background') return [subagentCall('call_b', BG_B), finish('tool-calls')]
      if (lastText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('Answered.')
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: recordingSubagentPort().port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Do something long')

    heldA.open()
    await waitFor(() => finishedCount(store.entries) === 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.some((call) => call.lastText.startsWith(NOTE))).toBe(false)

    await runtime.prompt('What did A find?')
    const prompt = calls.at(-1)!.options.prompt
    const texts = prompt
      .slice(-2)
      .map((message) =>
        message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''
      )
    expect(texts[0]).toBe('What did A find?')
    expect(texts[1]).toMatch(/^Background subagent update[\s\S]*"Check A"[\s\S]*REPORT-A/)

    await runtime.prompt('Check B in the background')
    heldB.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE) && call.lastText.includes('REPORT-B')))
  })

  // Review focus 4. Breaks when a waiting result only rides with a prompt (or Pi's nextTurn queue): a
  // command that starts its own turn (`/goal resume`) never carries it, so that turn's settle must.
  it('delivers a waiting result in a turn a command starts', async () => {
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
    const roundCommand: ExtensionFactory = (pi) => {
      pi.registerCommand('round', {
        description: 'Starts a turn of its own',
        handler: async () => {
          pi.sendMessage({ customType: 'test.round', content: 'ROUND', display: false }, { triggerTurn: true })
        }
      })
    }
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: recordingSubagentPort().port,
      extensionFactories: [roundCommand],
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Do something long')
    held.open()
    await waitFor(() => finishedCount(store.entries) === 1)

    await runtime.prompt('/round')
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    expect(
      parentCalls(calls)
        .slice(-2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['ROUND', 'notification'])
  })

  // Breaks when an oversized report is put into the context whole although the host offloads.
  it('offloads a long result through the host store and sends its marker', async () => {
    const saved: Parameters<ToolOutputStore['save']>[0][] = []
    const store: ToolOutputStore = {
      async save(file) {
        saved.push(file)
        return `/offload/${file.name}`
      }
    }
    const held = gate()
    const long = 'R'.repeat(30_000)
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply(long))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('Answered.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      offload: { store, thresholdChars: 5_000 }
    })
    await session.prompt('Check A in the background')
    held.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const text = calls.find((call) => call.lastText.startsWith(NOTE))!.lastText
    expect(saved).toEqual([expect.objectContaining({ content: long, toolCallId: 'call_a', toolName: 'subagent' })])
    expect(text).toContain('<persisted-output>')
    expect(text).toContain(`Full output saved to: /offload/${saved[0].name}`)
    expect(text.length).toBeLessThan(5_000)
  })

  // Breaks when an oversized report is put into the context whole without an offload store, or a
  // report within the limit is cut.
  it('keeps the head and tail of a result over 20,000 characters when nothing offloads', async () => {
    const heldA = gate()
    const heldB = gate()
    const head = 'H'.repeat(10_000)
    const tail = 'T'.repeat(10_001)
    const fits = 'F'.repeat(20_000)
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply(head + tail))
      if (userText.includes('TASK-B')) return heldB.wait(reply(fits))
      if (lastText === 'Check A and B')
        return [subagentCall('call_a', BG_A), subagentCall('call_b', BG_B), finish('tool-calls')]
      return reply('Answered.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Check A and B')
    heldA.open()
    await waitFor(() => calls.filter((call) => call.lastText.startsWith(NOTE)).length === 1)
    heldB.open()
    await waitFor(() => calls.filter((call) => call.lastText.startsWith(NOTE)).length === 2)

    const [a, b] = calls.filter((call) => call.lastText.startsWith(NOTE)).map((call) => call.lastText)
    expect(a).toContain(`  ${'H'.repeat(8_000)}\n  [… 4001 characters left out …]\n  ${'T'.repeat(8_000)}`)
    expect(a).not.toContain('H'.repeat(8_001))
    expect(b).toContain(`  ${fits}`)
  })
})
