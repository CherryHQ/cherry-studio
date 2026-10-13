import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import {
  approvals,
  crashedTranscript,
  goalPort,
  goalSession,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  readGoal,
  rounds,
  snapshots,
  working
} from './goalSupport'
import {
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResults
} from './subagentSupport'
import { finish, MODEL, plain, tempDir, textParts } from './support'

describe('goal across sessions', () => {
  // Breaks when session_start restores the goal armed: the first message's settle would start round 2.
  it('a session rebuilt after a crash mid-round restores the goal disarmed, and resume continues it', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort({ defaults: { maxGoalRounds: 3 } }), cwd)
    const { session: s, host, calls } = await goalSession([working], goalPort(), { cwd, transcript })

    await promptIdle(s, 'hello again')
    expect(calls).toHaveLength(1)
    expect(rounds(host.entries)).toEqual([])
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('Goal: Keep working\nPhase: active · disarmed\nRounds: 1/3 · Tokens: 0')

    await promptIdle(s, '/goal resume')
    // The cap is stored on the goal, so the rebuilt session keeps 3 although its port says 100.
    expect(rounds(host.entries).map((round) => round.round)).toEqual([2, 3])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a model without tool calling still gets the goal tools or the command, or the goal is left looking runnable.
  it('a model without tool calling gets no goal tools or command, and an active goal is marked unsupported', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort(), cwd)
    const {
      session: s,
      host,
      calls
    } = await goalSession([working], goalPort({ modelSupportsTools: () => false }), {
      cwd,
      transcript
    })
    await promptIdle(s, '/goal')

    expect(calls[0].tools?.map((tool) => tool.name) ?? []).not.toContain('get_goal')
    // Without the command, `/goal` reaches the model as text.
    expect(JSON.stringify(calls[0].prompt.at(-1))).toContain('/goal')
    expect(notices(host.entries)).toEqual([])
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'unsupported_model' } })
  })

  // Breaks when every restored goal is marked unsupported: a paused goal would lose why it paused, and a
  // complete one would turn blocked, which resume reopens.
  it('a model without tool calling leaves a goal that is not active as it is', async () => {
    const cwd = tempDir('cwd')
    const paused = await goalSession([working], goalPort({ defaults: { autonomy: () => 'confirm-each-round' } }), {
      cwd
    })
    await promptIdle(paused.session, '/goal Keep working')
    expect(lastSnapshot(paused.host.entries)).toMatchObject({ phase: 'paused' })

    const { session: s, host } = await goalSession([working], goalPort({ modelSupportsTools: () => false }), {
      cwd,
      transcript: plain(paused.host.entries)
    })
    await promptIdle(s, 'hello')
    expect(snapshots(host.entries)).toEqual([])
  })

  // Breaks when a round prompt leans on history for the objective: once compaction folds round 1 the request lacks it.
  it('after compaction folds the first rounds, the next round prompt still carries the objective', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      // Pi anchors its context estimate on reported usage, so report a prompt-sized input; ~1.2k tokens of
      // reply per round cross a 9k window with a 2k reserve after a few rounds.
      [
        (prompt, call) => [
          ...textParts('t', `step ${call}: ${'detail '.repeat(600)}`),
          finish('stop', Math.ceil(JSON.stringify(prompt).length / 3.5), 1_200)
        ]
      ],
      goalPort({ defaults: { maxGoalRounds: 8 } }),
      {
        model: { ...MODEL, contextWindow: 9_000 },
        compaction: { reserveTokens: 2_000, keepRecentTokens: 1_000, summarize: async () => 'SUMMARY-MARKER' }
      }
    )
    await promptIdle(s, '/goal Finish the OBJECTIVE-MARKER work')

    expect(host.entries.some((entry) => entry.kind === 'compaction')).toBe(true)
    const afterCompaction = calls.find((call) => JSON.stringify(call.prompt).includes('SUMMARY-MARKER'))!
    expect(JSON.stringify(afterCompaction.prompt)).not.toContain('step 1:')
    expect(JSON.stringify(afterCompaction.prompt.at(-1))).toContain('OBJECTIVE-MARKER')
  })
})

describe('goal inside a subagent', () => {
  // Breaks when the fork treats the goal entries it inherited as its own, or starts one: get_goal
  // returns the parent's goal, resume or create arms one, and the fork gets a goal round after its report.
  it('a fork started in a goal round inherits the goal entries but cannot read, create, resume or continue a goal', async () => {
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-FORK')) {
        if (call.lastRole === 'user')
          return [
            toolCallPart('fork_get', 'get_goal'),
            toolCallPart('fork_create', 'create_goal', { objective: 'A goal of the fork' }),
            finish('tool-calls')
          ]
        if (toolResults(call).at(-1)?.toolName === 'create_goal') {
          // Copy what get_goal returned, as a model would; a failed get_goal leaves nothing to copy.
          const { goal } = readGoal(call.options.prompt)
          return [
            toolCallPart('fork_resume', 'update_goal', {
              goal_id: goal?.id ?? 'none',
              revision: goal?.revision ?? 0,
              action: 'resume'
            }),
            finish('tool-calls')
          ]
        }
        return [...textParts('r', 'FORK-REPORT'), finish('stop')]
      }
      return call.lastRole === 'user'
        ? [
            subagentCall('call_fork', { description: 'Fork check', prompt: 'TASK-FORK', fork: true }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'The fork reported back.'), finish('stop')]
    })
    const port = goalPort({ defaults: { autonomy: () => 'confirm-each-round' } })
    // A fork must get the parent's extensions (README "Subagents"), so the goal extension loads in it too.
    const subagents = recordingSubagentPort(() => ({ extensionFactories: [createGoalExtension(port)] }))
    const { session: s } = await openGoalSession(model, port, { subagents: subagents.port })
    await promptIdle(s, '/goal Keep working')

    const forkCalls = calls.filter((call) => call.userText.includes('TASK-FORK'))
    // The fork started from the goal round, so the goal was on its branch.
    expect(forkCalls[0].userText).toContain('<goal_round>')
    // get_goal and create_goal, update_goal, the report: no goal round follows in the fork.
    expect(forkCalls).toHaveLength(3)
    const goalResults = toolResults(forkCalls.at(-1)!).filter((part) => part.toolCallId.startsWith('fork_'))
    expect(goalResults.map((part) => [part.toolName, part.output.type])).toEqual([
      ['get_goal', 'error-text'],
      ['create_goal', 'error-text'],
      ['update_goal', 'error-text']
    ])
    for (const part of goalResults) expect(outputText(part.output)).toMatch(/belong to the main agent/)
  })

  // Breaks when a subagent's session_start subscribes to the approval port too: on a port with a single
  // listener the fork's subscription replaces the parent's, and the parent's denial goes unheard. Breaks
  // too when session_shutdown keeps the subscription: the host would hold every rebuilt session's listener.
  it("a fork does not take the parent's approval listener, which the parent releases at shutdown", async () => {
    const { port, tool, listening } = approvals('denied', { defaults: { maxGoalRounds: 2 } })
    const { model } = routedModel((call) => {
      if (call.userText.includes('TASK-FORK')) return [...textParts('r', 'FORK-REPORT'), finish('stop')]
      if (call.lastRole === 'user')
        return [
          subagentCall('call_fork', { description: 'Fork check', prompt: 'TASK-FORK', fork: true }),
          finish('tool-calls')
        ]
      return toolResults(call).at(-1)?.toolName === 'subagent'
        ? [toolCallPart('call_risky', 'risky'), finish('tool-calls')]
        : [...textParts('d', 'Checked.'), finish('stop')]
    })
    const subagents = recordingSubagentPort(() => ({ extensionFactories: [createGoalExtension(port)] }))
    const {
      session: s,
      host,
      dispose
    } = await openGoalSession(model, port, { tools: [tool], subagents: subagents.port })
    await promptIdle(s, '/goal Keep working')

    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 1,
      lastStop: { code: 'approval_denied' }
    })
    await dispose()
    expect(listening()).toBe(false)
  })
})
