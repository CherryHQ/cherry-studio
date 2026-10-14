import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort } from '../src'
import {
  gate,
  outputText,
  recordingSubagentPort,
  routedModel,
  stopTurnTool,
  subagentCall,
  subagentsDone,
  subagentStates,
  subagentViews,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }

describe('background subagents', () => {
  // Breaks when a background launch still blocks until the subagent ends, when the parent's turn
  // ending stops it, or when its runs leave no snapshots or events for the host.
  it('returns its id at once, keeps running after the turn ends, and records its run', async () => {
    const held = gate()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop', 100, 20)])
      return lastText === 'Check A in the background'
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A in the background')
    await held.reached

    const { sessionId } = host.subagents[0]
    expect(host.subagents[0].background).toBe(true)
    const result = toolResultOf(session, 'call_a')
    expect(result.details).toEqual({ sessionId, fork: false, background: true })
    expect(textOf(result)).toBe(
      `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
    )
    expect(parent.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)

    held.open()
    await waitFor(() => subagentStates(parent.entries).length === 2)
    const view = { sessionId, parentToolCallId: 'call_a', description: 'Check A' }
    expect(subagentStates(parent.entries)).toEqual([
      { ...view, fork: false, background: true, modelKey: 'cherry::bridged-model', run: 1, status: 'running' },
      expect.objectContaining({
        ...view,
        run: 1,
        status: 'finished',
        outcome: 'completed',
        report: 'REPORT-A',
        usage: expect.objectContaining({ totalTokens: 122 })
      })
    ])
    expect(subagentViews(parent.events)).toEqual([
      [{ ...view, status: 'running' }],
      [{ ...view, status: 'finished', outcome: 'completed' }]
    ])
  })

  // Breaks when the launching call's signal still reaches the subagent (D2: stopping a turn is not
  // stopping its background subagents).
  it('keeps running when the turn that launched it is aborted', async () => {
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Check A, then stop'
        ? [subagentCall('call_a', BG_A), toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurnTool(parent, () => held.reached)],
      subagents: recordingSubagentPort().port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session

    await runtime.session.prompt('Check A, then stop')
    expect(store.events.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
    held.open()

    await waitFor(() => subagentStates(store.entries).some((state) => state.status === 'finished'))
    expect(subagentStates(store.entries).at(-1)).toMatchObject({ outcome: 'completed', report: 'REPORT-A' })
  })

  // Breaks when the cap is missing or counts foreground subagents, or when calls of one step all pass
  // the check before any of them has started.
  it('runs at most 20 background subagents at once, while foreground subagents still run', async () => {
    const held = gate()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-BG')) return held.wait([...textParts('r', 'BG'), finish('stop')])
      if (userText.includes('TASK-FG')) return [...textParts('r', 'REPORT-FG'), finish('stop')]
      if (lastText === 'Now one in the foreground')
        return [subagentCall('call_fg', { description: 'FG', prompt: 'TASK-FG' }), finish('tool-calls')]
      if (lastText !== 'Start 21 in the background') return [...textParts('d', 'Done'), finish('stop')]
      return [
        ...Array.from({ length: 21 }, (_, i) =>
          subagentCall(`call_${i}`, { description: `BG ${i}`, prompt: `TASK-BG ${i}`, background: true })
        ),
        finish('tool-calls')
      ]
    })
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })

    await session.prompt('Start 21 in the background')
    const results = Array.from({ length: 21 }, (_, i) => toolResultOf(session, `call_${i}`))
    const refused = results.filter((result) => result.isError)
    expect(refused).toHaveLength(1)
    expect(textOf(refused[0])).toBe(
      '20 background subagents are already running; wait for one to finish before starting another.'
    )

    await session.prompt('Now one in the foreground')
    expect(textOf(toolResultOf(session, 'call_fg'))).toMatch(/^REPORT-FG/)
    held.open()
    await subagentsDone(session, parent.events)
  })

  // Review focus 1. Breaks when a launch whose configure fails keeps its background slot: after
  // maxBackground failures no background subagent could start again.
  it('frees the background slot of a launch that fails', async () => {
    const held = gate()
    let failNext = true
    const recording = recordingSubagentPort()
    const port: SubagentPort = {
      maxBackground: 1,
      async configure(subagent) {
        if (failNext) {
          failNext = false
          throw new Error('no workspace for subagents')
        }
        return recording.port.configure(subagent)
      }
    }
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText.startsWith('Check A')
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A in the background')
    expect(textOf(toolResultOf(session, 'call_a'))).toBe('no workspace for subagents')
    await session.prompt('Check A again')
    expect(textOf(toolResultOf(session, 'call_a'))).toMatch(/^Subagent started in the background/)
    held.open()
    await subagentsDone(session, parent.events)
  })

  // Review focus 3. Breaks when a background fork is built unlike a foreground one: no forked
  // conversation or no placeholder result for its own call.
  it('starts a background fork from the conversation as it is', async () => {
    const held = gate()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Fork A in the background; the codename is ORCHID'
        ? [subagentCall('call_a', { ...BG_A, fork: true }), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })

    await session.prompt('Fork A in the background; the codename is ORCHID')
    await held.reached

    const fork = calls.find((call) => call.userText.includes('TASK-A'))!
    expect(fork.userText).toContain('ORCHID')
    expect(toolResults(fork).map((part) => [part.toolCallId, outputText(part.output)])).toEqual([
      ['call_a', 'This tool call was still running when the subagent started; its result is not available here.']
    ])
    held.open()
    await subagentsDone(session, parent.events)
  })

  // Breaks when shutdown leaks a running subagent session, or writes a snapshot or event after the
  // parent is gone (a rebuild infers `interrupted` from the last `running` snapshot instead).
  it('stops and disposes its background subagents when the parent is disposed, writing nothing more', async () => {
    const held = gate()
    let shutdowns = 0
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Check A in the background'
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: store.onEvent
    })
    await runtime.session.prompt('Check A in the background')
    await held.reached
    const eventsBefore = store.events.length

    await runtime.dispose()

    expect(shutdowns).toBe(1)
    expect(calls.find((call) => call.userText.includes('TASK-A'))!.options.abortSignal?.aborted).toBe(true)
    expect(subagentStates(store.entries).map((state) => state.status)).toEqual(['running'])
    expect(store.events).toHaveLength(eventsBefore)
  })
})
