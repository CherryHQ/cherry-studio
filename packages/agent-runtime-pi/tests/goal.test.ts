import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  askAtTurnEnd,
  crashedTranscript,
  goalNotices,
  goalPort,
  goalSession,
  goalStates,
  heldGoalSession,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  readGoal,
  rounds,
  roundStart,
  say,
  snapshots,
  working
} from './goalSupport'
import { recordingSubagentPort, routedModel, subagentCall, toolCallPart } from './subagentSupport'
import { finish, tempDir, textParts } from './support'
import { textOf, toolResults } from './toolResults'

/** One round per command or resume, so command tests see a settled goal. */
const confirmEachRound = goalPort({ defaults: { autonomy: () => 'confirm-each-round' } })

describe('goal tools', () => {
  it('lets the model create a goal in a human turn and read it back with the same id', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession([
      () => [
        toolCallPart('c1', 'create_goal', { objective: 'Ship the docs gate', max_goal_rounds: 5 }),
        finish('tool-calls')
      ],
      () => [toolCallPart('c2', 'get_goal', {}), finish('tool-calls')],
      () => say('Started.')
    ])
    await s.prompt('Please make every docs gate pass')

    const created = readGoal(calls[1].prompt)
    const read = readGoal(calls[2].prompt)
    expect(created.goal).toMatchObject({
      objective: 'Ship the docs gate',
      maxGoalRounds: 5,
      phase: 'active',
      revision: 1
    })
    expect(read.goal?.id).toBe(created.goal?.id)
    expect(snapshots(host.entries).at(0)).toMatchObject({ objective: 'Ship the docs gate' })
  })

  it('rejects a stale revision and returns the current view instead of applying the change', async () => {
    const { session: s, calls } = await goalSession([
      () => [toolCallPart('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCallPart('c2', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: 1,
          action: 'edit',
          objective: 'g2'
        }),
        finish('tool-calls')
      ],
      (prompt) => [
        toolCallPart('c3', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: 1,
          action: 'complete',
          evidence: 'done'
        }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')

    const [, , stale] = toolResults(s)
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toMatch(/stale/i)
    expect(textOf(stale)).toContain('"revision":2')
    expect(textOf(stale)).toContain('"objective":"g2"')
    expect(readGoal(calls[3].prompt).goal).toMatchObject({ revision: 2, objective: 'g2', phase: 'active' })
  })

  it('refuses a second goal while one is unfinished', async () => {
    const { session: s } = await goalSession([
      () => [toolCallPart('c1', 'create_goal', { objective: 'first' }), finish('tool-calls')],
      () => [toolCallPart('c2', 'create_goal', { objective: 'second' }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, second] = toolResults(s)
    expect(second.isError).toBe(true)
    expect(textOf(second)).toMatch(/already/i)
  })

  it('treats empty strings and zero as omitted optional fields', async () => {
    const { session: s, calls } = await goalSession([
      () => [
        toolCallPart('c1', 'create_goal', { objective: 'g', max_goal_rounds: 0, budget_tokens: 0 }),
        finish('tool-calls')
      ],
      (prompt) => [
        toolCallPart('c2', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: readGoal(prompt).goal!.revision,
          action: 'pause',
          objective: '',
          blocked_reason: '',
          max_goal_rounds: 0
        }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')
    expect(readGoal(calls[1].prompt).goal).toMatchObject({ maxGoalRounds: 100 })
    expect(readGoal(calls[1].prompt).goal?.budget).toBeUndefined()

    const [, paused] = toolResults(s)
    expect(paused.isError).toBe(false)
    expect(readGoal(calls[2].prompt).goal).toMatchObject({ phase: 'paused' })
  })

  it('rejects a negative round cap instead of treating it as omitted', async () => {
    const { session: s, host } = await goalSession([
      () => [toolCallPart('c1', 'create_goal', { objective: 'g', max_goal_rounds: -1 }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    const [created] = toolResults(s)
    expect(created.isError).toBe(true)
    expect(textOf(created)).toMatch(/between 1 and/)
    expect(snapshots(host.entries)).toHaveLength(0)
  })

  it('refuses an edit that changes nothing and appends no snapshot', async () => {
    const { session: s, host } = await goalSession([
      () => [toolCallPart('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCallPart('c2', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'edit' }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, edit] = toolResults(s)
    expect(edit.isError).toBe(true)
    expect(textOf(edit)).toBe('edit needs an objective, max_goal_rounds, budget_tokens or budget_usd')
    // The goal goes on into rounds after this turn; every snapshot before round 1 belongs to the turn.
    expect(snapshots(host.entries).filter((goal) => goal.roundsStarted === 0)).toHaveLength(1)
  })

  it('resuming an active goal returns its view without a new snapshot', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession([
      () => [toolCallPart('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCallPart('c2', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'resume' }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, resumed] = toolResults(s)
    expect(resumed.isError).toBe(false)
    expect(readGoal(calls[2].prompt)).toMatchObject({ goal: { revision: 1, phase: 'active' }, activation: 'armed' })
    expect(snapshots(host.entries).filter((goal) => goal.roundsStarted === 0)).toHaveLength(1)
  })
})

describe('/goal command', () => {
  it('answers control words with a notice when no goal exists, without a model turn', async () => {
    const { session: s, host, calls } = await goalSession([working])
    for (const command of ['pause', 'resume', 'clear', 'rounds 2000', '']) await s.prompt(`/goal ${command}`.trim())

    // Matching the whole list catches a command that answers with no notice, or with two.
    expect(notices(host.entries)).toEqual([
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set. Use /goal <objective> to create one.'
    ])
    expect(calls).toHaveLength(0)
  })

  // Breaks when a leading "edit" is read as the edit command although there is no goal to edit.
  it('with no goal, a leading edit is part of a new objective', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Edit the onboarding docs')
    expect(snapshots(host.entries)[0]).toMatchObject({ objective: 'Edit the onboarding docs' })
    expect(notices(host.entries)).toEqual(['Goal created.'])
  })

  // Breaks when an edit with nothing after it falls through to create: the goal's objective would be "edit".
  it('with no goal, an edit with no objective answers that no goal is set', async () => {
    const { session: s, host, calls } = await goalSession([working])
    for (const command of ['/goal edit', '/goal Edit   ']) await s.prompt(command)
    expect(notices(host.entries)).toEqual(['No goal is set.', 'No goal is set.'])
    expect(snapshots(host.entries)).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  // Breaks when the edit path checks a fixed cap instead of the host's ceiling.
  it('reports a cap above the ceiling and an empty objective as errors', async () => {
    const { session: s, host } = await goalSession(
      [working],
      goalPort({ defaults: { autonomy: () => 'confirm-each-round', maxGoalRounds: 10, maxGoalRoundsCeiling: 50 } })
    )
    await promptIdle(s, '/goal Fix it')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix it' })
    const before = lastSnapshot(host.entries)!
    await s.prompt('/goal rounds 60')
    expect(goalNotices(host.entries).at(-1)).toEqual({
      text: expect.stringMatching(/between 1 and 50/),
      level: 'error'
    })
    expect(lastSnapshot(host.entries)).toMatchObject({ revision: before.revision, maxGoalRounds: 10 })
    await s.prompt('/goal edit    ')
    expect(notices(host.entries).at(-1)).toMatch(/1-4000/)
  })

  it('edits the objective, round cap and budget of the current goal', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    await s.prompt('/goal edit Fix the docs\n\n  then the  tests')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix the docs\n\n  then the  tests' })
    await s.prompt('/goal rounds 20')
    expect(lastSnapshot(host.entries)).toMatchObject({ maxGoalRounds: 20 })
    await s.prompt('/goal budget 5000')
    expect(lastSnapshot(host.entries)).toMatchObject({ budget: { tokens: 5000 } })
    await s.prompt('/goal budget $1.5')
    expect(lastSnapshot(host.entries)).toMatchObject({ budget: { tokens: 5000, usd: 1.5 } })
    expect(goalNotices(host.entries).map((notice) => notice.level)).not.toContain('error')
  })

  it('treats rounds and budget as an objective unless a single number follows', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal rounds of tests until CI passes')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'rounds of tests until CI passes' })
    await s.prompt('/goal clear')
    await promptIdle(s, '/goal budget the release')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'budget the release' })
  })

  it('matches control words regardless of case', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    await promptIdle(s, '/goal RESUME')
    await s.prompt('/goal Pause')
    expect(notices(host.entries)).toEqual(['Goal created.', 'Goal resumed.', 'Goal is already paused.'])
    expect(rounds(host.entries)).toHaveLength(2)
  })

  // Breaks when the command does not abort the round, or when the aborted run's settle stops the goal a second time.
  it('pausing an active goal stops its round; pausing again appends nothing', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    const before = snapshots(host.entries).length
    await promptIdle(s, '/goal pause')
    await s.prompt('/goal pause')
    expect(held.aborted(1)).toBe(true)
    expect(snapshots(host.entries)).toHaveLength(before + 1)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'paused', lastStop: { code: 'paused_by_user' } })
    expect(notices(host.entries).slice(-2)).toEqual(['Goal paused.', 'Goal is already paused.'])
  })

  it('reports the goal as status text', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('Goal: Fix it\nPhase: active · armed\nRounds: 1/100 · Tokens: 0')
    await promptIdle(s, '/goal pause')
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe(
      'Goal: Fix it\nPhase: paused (paused_by_user) · disarmed\nRounds: 1/100 · Tokens: 0'
    )
  })

  // Breaks when the status prints the cost as a raw float sum, such as $0.000060599999999999996.
  it('shows the cost in the status text at a fixed precision', async () => {
    const { session: s, host } = await goalSession(
      [() => [...textParts('t', 'done'), finish('stop', 40_000, 1_000)]],
      confirmEachRound
    )
    await promptIdle(s, '/goal Fix it')
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toMatch(/· Cost: \$0\.0420$/)
  })

  it('clearing writes a tombstone, after which the goal is gone', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    const goal = lastSnapshot(host.entries)!
    await s.prompt('/goal clear')
    expect(goalStates(host.entries).at(-1)).toEqual({
      id: goal.id,
      revision: goal.revision + 1,
      cleared: true,
      at: expect.any(Number)
    })
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('No goal is set. Use /goal <objective> to create one.')
  })

  it('a goal created after a clear starts with no usage', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal First')
    await s.prompt('/goal clear')
    await promptIdle(s, '/goal Second')
    // First's round used 17 tokens, so there was usage to leak.
    expect(
      snapshots(host.entries)
        .filter((goal) => goal.objective === 'First')
        .at(-1)
    ).toMatchObject({ tokensUsed: 17 })
    expect(snapshots(host.entries).find((goal) => goal.objective === 'Second')).toMatchObject({
      tokensUsed: 0,
      costUsed: 0
    })
  })

  it('clearing a goal that is not active leaves the running turn alone', async () => {
    const { session: s, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    await promptIdle(s, '/goal pause')
    const run = s.prompt('go')
    await held.started(2)
    await s.prompt('/goal clear')
    expect(held.aborted(2)).toBe(false)
    held.release()
    await run
  })

  // Breaks when clear decides on the abort after it disarmed the goal: the cleared goal's round would run on.
  it('clearing an active goal stops its round', async () => {
    const { session: s, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    await promptIdle(s, '/goal clear')
    expect(held.aborted(1)).toBe(true)
  })

  // Breaks when the command aborts any turn of an active goal: one restored from the transcript is
  // not armed, so the user's own turn would be cut off.
  it.each(['pause', 'clear'])('/goal %s on a goal that is not armed leaves the running turn alone', async (command) => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort(), cwd)
    const { session: s, held } = await heldGoalSession(goalPort(), { cwd, transcript })
    const run = s.prompt('hello')
    await held.started(1)
    await s.prompt(`/goal ${command}`)
    expect(held.aborted(1)).toBe(false)
    held.release()
    await run
  })

  // Breaks when resume re-arms an active goal without checking its capacity: the crash left its only round admitted.
  it('resume refuses an active goal that has no round left', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort({ defaults: { maxGoalRounds: 1 } }), cwd)
    const { session: s, host, calls } = await goalSession([working], goalPort(), { cwd, transcript })
    await promptIdle(s, '/goal resume')
    expect(goalNotices(host.entries)).toEqual([
      { text: 'raise max_goal_rounds or the budget before resuming', level: 'error' }
    ])
    expect(calls).toHaveLength(0)
  })

  // Breaks when resume starts a round although it changed nothing: the notice says the goal is
  // already active, yet a second round would run.
  it('resume on a goal that is already active and armed starts no round', async () => {
    const user: { session?: AgentSession } = {}
    let resumeAtSettle = false
    // Re-arms the goal after its settle decision, so the run ends with the goal active and armed.
    const resumeAfterDecision: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', async () => {
        if (!resumeAtSettle) return
        resumeAtSettle = false
        await user.session!.prompt('/goal resume')
      })
    }
    const {
      session: s,
      host,
      calls
    } = await goalSession([working], confirmEachRound, { laterExtensions: [resumeAfterDecision] })
    user.session = s
    await promptIdle(s, '/goal Keep working')
    resumeAtSettle = true
    await promptIdle(s, 'hello')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'active', roundsStarted: 1 })

    await promptIdle(s, '/goal resume')
    expect(notices(host.entries)).toEqual(['Goal created.', 'Goal resumed.', 'Goal is already active.'])
    expect(rounds(host.entries)).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })
})

describe('goal continuation', () => {
  // Breaks when the command does not start a run, a round is admitted twice, or the model does not get the round prompt.
  it('an idle /goal starts round 1 and each settle pushes one more round', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }))
    await promptIdle(s, '/goal Keep working')

    // The command started the run itself: the round prompt is the request's only user message.
    expect(calls[0].prompt.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, 2, 3])
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2, 3])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3 })
  })

  // Breaks when a round counts at its reservation instead of its admission.
  it('does not count a round that a later extension vetoed', async () => {
    const veto: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', () => ({ continue: false }))
    }
    const { session: s, host, calls } = await goalSession([working], goalPort(), { laterExtensions: [veto] })
    await promptIdle(s, '/goal Keep working')

    expect(calls).toHaveLength(1)
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 1,
      lastStop: { code: 'continuation_rejected' }
    })
  })

  // Breaks when the continuation replaces the entries an earlier extension proposed at the same settle.
  it('keeps what an earlier extension adds at the settle the goal continues', async () => {
    let added = false
    const noteAtFirstSettle: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', () => {
        if (added) return undefined
        added = true
        const note = {
          type: 'custom_message' as const,
          customType: 'test.note',
          content: 'NOTE-MARKER',
          display: false
        }
        return { entries: [note], continue: true }
      })
    }
    const {
      session: s,
      host,
      calls
    } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 2 } }), {
      extensionFactories: [noteAtFirstSettle]
    })
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].prompt)).toContain('NOTE-MARKER')
  })

  // Breaks when the goal yields to any pending message: Pi does not continue for an extension's
  // message sent without triggerTurn, so the run would end with the goal active, armed and idle.
  it('does not yield to an extension message that starts no turn', async () => {
    let sent = false
    const noteAtFirstSettle: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', () => {
        if (sent) return
        sent = true
        pi.sendMessage({ customType: 'test.note', content: 'NOTE-MARKER', display: false }, { triggerTurn: false })
      })
    }
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 2 } }), {
      extensionFactories: [noteAtFirstSettle]
    })
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })

  // Breaks without spec §6.2 step 7: Pi would send the round before the waiting message, or the goal would end there.
  it('yields to a user message waiting at the settle and continues after it', async () => {
    const user: { session?: AgentSession } = {}
    let asked = false
    // Loaded before the goal extension, so the message is already waiting when the goal decides.
    const askAtFirstSettle: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', async () => {
        if (asked) return
        asked = true
        await user.session!.prompt('a question from the user', { streamingBehavior: 'followUp' })
      })
    }
    const opened = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }), {
      extensionFactories: [askAtFirstSettle]
    })
    user.session = opened.session
    await promptIdle(opened.session, '/goal Keep working')

    expect(opened.calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined, 2, 3])
    expect(JSON.stringify(opened.calls[1].prompt.at(-1))).toContain('a question from the user')
    expect(lastSnapshot(opened.host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a human turn is looked for at turn_start (the user message is not on the branch yet): its reply would be billed.
  it('a user message taken in during a goal run is a human turn, not billed to the goal', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 2 } }))
    askAtTurnEnd(s, 1)
    await promptIdle(s, '/goal Keep working')

    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined, 2])
    // Two round replies of 17 tokens (`finish`: 10 + 2 cached input, 5 output); the question's reply is not the goal's.
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 2,
      tokensUsed: 34,
      lastStop: { code: 'round_limit' }
    })
  })

  it('in confirm-each-round mode each round ends paused and /goal resume runs one more', async () => {
    const { session: s, host, calls } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 1,
      phase: 'paused',
      lastStop: { code: 'paused_each_round' }
    })

    await promptIdle(s, '/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 2,
      phase: 'paused',
      lastStop: { code: 'paused_each_round' }
    })
    expect(calls).toHaveLength(2)
  })

  // Breaks when the pause looks only at whether the last turn was a goal round: the user's message
  // ends round 1, and the settle would start round 2 without a resume.
  it('in confirm-each-round mode a run that ran a goal round pauses, even when a user message ended it', async () => {
    const { session: s, host, calls } = await goalSession([working], confirmEachRound)
    askAtTurnEnd(s, 1)
    await promptIdle(s, '/goal Keep working')

    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined])
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 1,
      phase: 'paused',
      lastStop: { code: 'paused_each_round' }
    })
    await promptIdle(s, 'hello')
    expect(rounds(host.entries)).toHaveLength(1)
  })

  // Breaks when a resume does not start the run's count over: the settle after it would pause again
  // before any round ran.
  it('in confirm-each-round mode a resume typed later in the same run gets one more round', async () => {
    const user: { session?: AgentSession } = {}
    let settles = 0
    // Loaded before the goal extension: asks at the first settle, resumes at the second.
    const askThenResume: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', async () => {
        settles += 1
        if (settles === 1) await user.session!.prompt('a question from the user', { streamingBehavior: 'followUp' })
        if (settles === 2) await user.session!.prompt('/goal resume')
      })
    }
    const opened = await goalSession([working], confirmEachRound, { extensionFactories: [askThenResume] })
    user.session = opened.session
    await promptIdle(opened.session, '/goal Keep working')

    expect(opened.calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined, 2])
    expect(lastSnapshot(opened.host.entries)).toMatchObject({
      roundsStarted: 2,
      lastStop: { code: 'paused_each_round' }
    })
  })

  it('a goal the model creates in a human turn continues in that run', async () => {
    const { session: s, host } = await goalSession(
      [() => [toolCallPart('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')], working],
      goalPort({ defaults: { maxGoalRounds: 2 } })
    )
    await s.prompt('please do g')
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })

  // Breaks when a command typed while the agent is busy sends a round of its own: Pi would deliver it
  // as a steering message inside the human turn, before the model's next reply.
  it("a command typed during a human turn only arms the goal; that turn's settle starts round 1", async () => {
    const {
      session: s,
      host,
      held
    } = await heldGoalSession(goalPort({ defaults: { maxGoalRounds: 2 } }), {}, [
      () => [toolCallPart('look', 'get_goal', {}), finish('tool-calls')],
      working
    ])
    const run = s.prompt('hello')
    await held.started(1)
    await s.prompt('/goal Keep working')
    held.release()
    await run

    // The human turn's tool call and reply, then rounds 1 and 2.
    expect(held.calls.map((call) => roundStart(call.prompt))).toEqual([undefined, undefined, 1, 2])
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
  })

  // Breaks when the human-turn check misses the goal round message (spec §8.1).
  it('refuses create, edit, pause and resume in a goal round', async () => {
    const { session: s } = await goalSession(
      [
        () => [toolCallPart('g', 'get_goal', {}), finish('tool-calls')],
        (prompt) => {
          const { goal } = readGoal(prompt)
          const ref = { goal_id: goal!.id, revision: goal!.revision }
          return [
            toolCallPart('create', 'create_goal', { objective: 'another' }),
            toolCallPart('edit', 'update_goal', { ...ref, action: 'edit', objective: 'changed' }),
            toolCallPart('pause', 'update_goal', { ...ref, action: 'pause' }),
            toolCallPart('resume', 'update_goal', { ...ref, action: 'resume' }),
            finish('tool-calls')
          ]
        },
        () => say('ok')
      ],
      goalPort({ defaults: { maxGoalRounds: 1 } })
    )
    await promptIdle(s, '/goal Keep working')
    const refused = toolResults(s).filter((result) => result.toolCallId !== 'g')
    expect(refused.map((result) => [result.toolCallId, result.isError])).toEqual([
      ['create', true],
      ['edit', true],
      ['pause', true],
      ['resume', true]
    ])
    for (const result of refused) expect(textOf(result)).toMatch(/needs a direct human request/)
  })

  // Breaks when turn_end counts only the assistant message's usage: the parent's 17 tokens per reply never reach the budget.
  it('counts the usage a subagent result reports toward the goal budget', async () => {
    const { model } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-SUB')) return [...textParts('r', 'REPORT'), finish('stop', 1_000, 500)]
      if (lastRole !== 'user') return [...textParts('d', 'Delegated the check.'), finish('stop')]
      return userText.includes('Do not start new work')
        ? [...textParts('w', 'Summary: the check ran in a subagent.'), finish('stop')]
        : [subagentCall('sub_1', { description: 'Check', prompt: 'TASK-SUB' }), finish('tool-calls')]
    })
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ defaults: { maxGoalRounds: 3, budget: { tokens: 1_000 } } }),
      { subagents: recordingSubagentPort().port }
    )
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'wrap-up'])
    // Three parent replies of 17 tokens and $0.0000202 each; the subagent's one reply has 1000 + 2
    // cached input and 500 output tokens, $0.0020002 at MODEL's prices.
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      tokensUsed: 1553,
      lastStop: { code: 'budget_exhausted' }
    })
    expect(lastSnapshot(host.entries)!.costUsed).toBeCloseTo(0.0020608, 10)
  })
})
