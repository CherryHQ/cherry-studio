import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort, ToolApprovalEvent } from '../src'
import {
  goalPort,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  rounds,
  roundStart,
  snapshots
} from './goalSupport'
import {
  gate,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  storingSubagentPort,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  toolResults,
  untilStopped,
  waitFor
} from './subagentSupport'
import { finish, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const reply = (text: string, input = 10): LanguageModelV3StreamPart[] => [
  ...textParts('t', text),
  finish('stop', input, 0)
]
/** A background launch; the description never holds the task marker the routes look for. */
const bg = (id: string, task: string) =>
  subagentCall(id, { description: `Check ${task.slice('TASK-'.length)}`, prompt: task, background: true })
const isNotice = (call: RoutedCall) => call.lastText.startsWith(NOTE)
const round = (call: RoutedCall) => (call.lastRole === 'user' ? roundStart(call.options.prompt) : undefined)

/** The user messages a request ends with: what started it. */
const trailingUserTexts = (call: RoutedCall) => {
  const texts: string[] = []
  for (let i = call.options.prompt.length - 1; i >= 0; i--) {
    const message = call.options.prompt[i]
    if (message.role !== 'user') break
    texts.unshift(message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''))
  }
  return texts
}

describe('goal and background subagents', () => {
  // Breaks when a goal blocks while its background subagents work, writes a snapshot for the wait,
  // or never goes on once their notification turn settles.
  it('waits for its background subagents and goes on after their notification', async () => {
    const held = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (round(call) === 1) return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call)) return reply('Read the report.')
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      subagents: recordingSubagentPort().port
    })
    await promptIdle(s, '/goal Check A')
    const waiting = snapshots(host.entries).length
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'active', roundsStarted: 1 })
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toMatch(/\nWaiting for 1 background subagent$/)

    held.open()
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')

    expect(snapshots(host.entries).length).toBeGreaterThan(waiting)
    expect(
      calls.filter((call) => round(call) !== undefined || isNotice(call)).map((call) => round(call) ?? 'notice')
    ).toEqual([1, 'notice', 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a request carries a goal round and a notification together (two starts in one request).
  it('lets the notification turn settle before the next round when both are due at one settle', async () => {
    const held = gate()
    const parentStates = { finished: () => false }
    const waitHere = defineTool({
      name: 'wait_here',
      label: 'Wait',
      description: 'Waits for A',
      parameters: Type.Object({}),
      async execute() {
        held.open()
        await waitFor(() => parentStates.finished())
        return { content: [{ type: 'text', text: 'waited' }], details: undefined }
      }
    })
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (round(call) === 1) return [bg('call_a', 'TASK-A'), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      tools: [waitHere],
      subagents: recordingSubagentPort().port
    })
    parentStates.finished = () => subagentStates(host.entries).some((state) => state.status === 'finished')
    await promptIdle(s, '/goal Check A')

    const starts = calls
      .filter((call) => call.lastRole === 'user' && !call.userText.includes('TASK-A'))
      .map((call) =>
        trailingUserTexts(call).map((text) =>
          text.startsWith(NOTE)
            ? 'notice'
            : `round ${roundStart([{ role: 'user', content: [{ type: 'text', text }] }])}`
        )
      )
    expect(starts).toEqual([['round 1'], ['notice'], ['round 2']])
  })

  // Breaks when a notification turn counts as a human turn: the model could create or change a goal
  // no person asked for.
  it('refuses create_goal in a notification turn', async () => {
    const held = gate()
    const { model } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (call.humanText === 'Check A in the background') return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call))
        return [toolCallPart('call_goal', 'create_goal', { objective: 'Fix everything A found' }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session: s, host } = await openGoalSession(model, goalPort(), { subagents: recordingSubagentPort().port })
    await s.prompt('Check A in the background')
    held.open()
    await waitFor(() => {
      try {
        return textOf(toolResultOf(s, 'call_goal')).length > 0
      } catch {
        return false
      }
    })

    expect(textOf(toolResultOf(s, 'call_goal'))).toMatch(/needs a direct human request/)
    expect(snapshots(host.entries)).toEqual([])
  })

  // Breaks when the parent's own usage in a notification turn is left out of an armed goal's budget,
  // or the usage of a subagent the goal did not start is put in.
  it("counts the parent's notification turn toward an armed goal, not a human turn's subagent", async () => {
    const held = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A', 5_000))
      if (call.humanText === 'Check A in the background') return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call)) return reply('Read the report.', 1_000)
      if (round(call) === 1) {
        // Round 1 settles while A still works, so its notification turn comes while the goal waits.
        void held.reached.then(() => setTimeout(held.open, 30))
        return reply('working')
      }
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      subagents: recordingSubagentPort().port
    })
    await s.prompt('Check A in the background')
    await held.reached
    await promptIdle(s, '/goal Keep working')
    await waitFor(() => rounds(host.entries).length === 2)

    // Round 1 (10 + 2 cached) and the notification turn (1000 + 2 cached); A's 5002 tokens are the human turn's.
    expect(snapshots(host.entries).find((snapshot) => snapshot.roundsStarted === 2)).toMatchObject({
      tokensUsed: 1_014
    })
  })

  // Breaks when a background subagent the goal started runs past the goal's budget unseen: its usage
  // must count at delivery, new background launches must be refused and running ones stopped.
  it("counts its subagents' usage, then refuses and stops background subagents once the budget is used up", async () => {
    const heldB = gate()
    const heldC = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B', 5_000))
      if (call.userText.includes('TASK-C')) return heldC.wait(reply('REPORT-C'))
      if (round(call) === 1) return [bg('call_b', 'TASK-B'), bg('call_c', 'TASK-C'), finish('tool-calls')]
      if (round(call) === 2) return [bg('call_d', 'TASK-D'), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ defaults: { maxGoalRounds: 5, budget: { tokens: 3_000 } } }),
      { subagents: recordingSubagentPort().port }
    )
    await promptIdle(s, '/goal Check B and C')
    await heldC.reached
    heldB.open()
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')

    expect(
      subagentStates(host.entries).find((state) => state.description === 'Check C' && state.status === 'finished')
    ).toMatchObject({
      outcome: 'stopped',
      stoppedBy: 'budget'
    })
    expect(rounds(host.entries).map((details) => details.kind)).toEqual(['work', 'wrap-up'])
    expect(textOf(toolResultOf(s, 'call_d'))).toBe(
      "The goal's budget is used up; background subagents cannot be started."
    )
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'budget_exhausted' } })
  })

  // Breaks when the run of a goal's background subagent that the model stops is left out of the
  // budget: it sends no notification, so its usage must come with the stop.
  it('counts the usage of a background subagent of the goal that the model stops', async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const { model, calls } = routedModel(async (call) => {
      if (call.userText.includes('TASK-B'))
        return call.lastText.includes('TASK-B')
          ? [toolCallPart('work_1', 'work'), finish('tool-calls', 5_000, 0)]
          : reply('LATE')
      if (round(call) === 1) return [bg('call_b', 'TASK-B'), finish('tool-calls', 10, 0)]
      if (call.lastRole === 'tool' && toolResults(call).at(-1)?.toolCallId === 'call_b') {
        await work.reached
        return [
          toolCallPart('call_stop', 'stop_subagent', { id: host.subagents[0].sessionId }),
          finish('tool-calls', 10, 0)
        ]
      }
      return reply(`working ${calls.length}`)
    })
    const { session: s, host: store } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      tools: [work.tool],
      subagents: host.port
    })
    await promptIdle(s, '/goal Check B')
    await waitFor(() => lastSnapshot(store.entries)?.phase === 'blocked')

    expect(toolResultOf(s, 'call_stop').details).toEqual({
      sessionId: host.subagents[0].sessionId,
      stopped: true,
      run: 1,
      usage: expect.objectContaining({ totalTokens: 5_002 })
    })
    // Four parent requests of 12 tokens (10 + 2 cached), and B's 5002.
    expect(lastSnapshot(store.entries)).toMatchObject({ tokensUsed: 5_050, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a continuation a goal round starts is left out of the budget because the goal did
  // not start that subagent in the background (here it ran in the foreground first).
  it('counts the continuation a goal round starts toward the goal', async () => {
    const host = storingSubagentPort()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return reply(call.lastText === 'GO-ON' ? 'REPORT-2' : 'REPORT-1', 5_000)
      if (round(call) === 1)
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls', 10, 0)]
      if (round(call) === 2)
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'GO-ON' }),
          finish('tool-calls', 10, 0)
        ]
      return reply(`working ${calls.length}`)
    })
    const { session: s, host: store } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 3 } }), {
      subagents: host.port
    })
    await promptIdle(s, '/goal Check A')
    await waitFor(() => lastSnapshot(store.entries)?.phase === 'blocked')

    expect(toolResultOf(s, 'call_msg').details).toEqual({
      sessionId: host.subagents[0].sessionId,
      continued: true,
      run: 2
    })
    // Six parent requests of 12 tokens, and both runs of A (5002 each: the foreground one counts with its result).
    expect(lastSnapshot(store.entries)).toMatchObject({ tokensUsed: 10_076, lastStop: { code: 'round_limit' } })
  })

  /**
   * A two-round goal whose round 1 starts subagent A by the call `call_a`; A's own call `call_a` is
   * denied, by an event that names its session when `named`. Resolves with the goal's last stop.
   */
  async function denyInSubagent({ background, named }: { background: boolean; named: boolean }) {
    const listeners = new Set<(event: ToolApprovalEvent) => void>()
    const onApproval = (listener: (event: ToolApprovalEvent) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
    const denyAll: ExtensionFactory = (pi) => {
      pi.on('tool_call', (event, ctx) => {
        const sessionId = named ? ctx.sessionManager.getSessionId() : undefined
        for (const listener of listeners)
          listener({ kind: 'denied', toolCallId: event.toolCallId, ...(sessionId ? { sessionId } : {}) })
        return { block: true, reason: 'denied' }
      })
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
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A'))
        return call.lastText.includes('TASK-A')
          ? [toolCallPart('call_a', 'risky'), finish('tool-calls')]
          : reply('REPORT-A')
      if (round(call) === 1)
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A', background }), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const recording = recordingSubagentPort(() => ({ extensionFactories: [denyAll] }))
    const subagents: SubagentPort = { ...recording.port, onApproval }
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ onApproval, defaults: { maxGoalRounds: 2 } }),
      { tools: [risky], subagents }
    )
    await promptIdle(s, '/goal Check A')
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')
    return lastSnapshot(host.entries)
  }

  // Breaks when a background subagent's denied call stops the parent's goal: the host's one approval
  // registry reports both, and providers may reuse call ids across sessions.
  it("ignores a background subagent's denied approval under the id of a call the parent made", async () => {
    expect(await denyInSubagent({ background: true, named: false })).toMatchObject({
      roundsStarted: 2,
      lastStop: { code: 'round_limit' }
    })
  })

  // Breaks when a foreground subagent's denied call stops the parent's goal although the event names
  // the subagent's session: the parent's `subagent` call of the same id runs all the while.
  it("ignores a foreground subagent's denied approval under the id of the parent's running call", async () => {
    expect(await denyInSubagent({ background: false, named: true })).toMatchObject({
      roundsStarted: 2,
      lastStop: { code: 'round_limit' }
    })
  })
})
