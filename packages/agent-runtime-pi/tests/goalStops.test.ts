import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createAskUserExtension, type GoalSnapshot } from '../src'
import {
  approvals,
  askAtTurnEnd,
  crashedTranscript,
  goalPort,
  goalSession,
  heldGoalSession,
  lastSnapshot,
  notices,
  promptIdle,
  readGoal,
  rounds,
  roundStart,
  say,
  snapshots,
  toolCall,
  working
} from './goalSupport'
import { finish, MODEL, tempDir, textParts } from './support'
import { textOf, toolResults } from './toolResults'

describe('goal caps and budgets', () => {
  it('runs the last allowed round as a wrap-up, then blocks with round_limit', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    expect(JSON.stringify(calls.at(-1)!.prompt.at(-1))).toContain('Do not start new work')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 3,
      wrapUpDone: true,
      lastStop: { code: 'round_limit' }
    })
  })

  it('after round_limit, resume is refused until the cap is raised, then one more round runs', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 1 } }))
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, lastStop: { code: 'round_limit' } })

    await promptIdle(s, '/goal resume')
    expect(notices(host.entries).at(-1)).toBe('raise max_goal_rounds or the budget before resuming')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, phase: 'blocked' })

    await s.prompt('/goal rounds 2')
    await promptIdle(s, '/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })

  it('a token budget ends the goal after one wrap-up round once crossed', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { budget: { tokens: 20 } } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    // Each reply: 10 + 2 cached input and 5 output tokens.
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      tokensUsed: 51,
      lastStop: { code: 'budget_exhausted' }
    })
  })

  it('a usd budget uses the price Pi computed from the model spec', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { budget: { usd: 0.00003 } } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    // MODEL prices input at $1, cached input at $0.1 and output at $2 per million tokens: $0.0000202 a reply.
    expect(lastSnapshot(host.entries)!.costUsed).toBeCloseTo(0.0000606, 12)
  })

  // Breaks when the budget check needs both limits crossed, or reads a usd budget a model without pricing can never reach.
  it('a model without pricing is held to its token budget alone', async () => {
    const unpriced = { ...MODEL, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    const { session: s, host } = await goalSession(
      [working],
      goalPort({ defaults: { budget: { usd: 0.00003, tokens: 40 } } }),
      { model: unpriced }
    )
    await promptIdle(s, '/goal Keep working')

    // 17 tokens a reply cross 40 after round 3.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'work', 'wrap-up'])
    expect(lastSnapshot(host.entries)).toMatchObject({ costUsed: 0, lastStop: { code: 'budget_exhausted' } })
  })

  it('the model can set a cap below the default but not above the ceiling', async () => {
    const { session: s, host } = await goalSession(
      [
        () => [
          toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: 60 }),
          toolCall('c2', 'create_goal', { objective: 'g', max_goal_rounds: 2 }),
          finish('tool-calls')
        ],
        working
      ],
      // A non-default ceiling, so a hard-coded one cannot pass.
      goalPort({ defaults: { maxGoalRounds: 10, maxGoalRoundsCeiling: 50 } })
    )
    await s.prompt('go')
    const [tooHigh, accepted] = toolResults(s)
    expect(tooHigh.isError).toBe(true)
    expect(textOf(tooHigh)).toMatch(/between 1 and 50\b/)
    expect(accepted.isError).toBe(false)
    expect(lastSnapshot(host.entries)).toMatchObject({
      maxGoalRounds: 2,
      roundsStarted: 2,
      lastStop: { code: 'round_limit' }
    })
  })
})

const readTool = defineTool({
  name: 'read',
  label: 'Read',
  description: 'Reads a file',
  parameters: Type.Object({ path: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: `contents of ${params.path}` }], details: undefined }
  }
})
const echoTool = defineTool({
  name: 'echo',
  label: 'Echo',
  description: 'Returns its input',
  parameters: Type.Object({ value: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: params.value }], details: undefined }
  }
})

describe('goal no-progress detection', () => {
  // Breaks when a read counts as progress (the goal would run to its cap), or when the repeat count
  // carries across rounds: round 3's read would be blocked.
  it('hints after two rounds without progress and stops after the third when every round only reads', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      [
        (prompt, call) =>
          roundStart(prompt) === undefined
            ? say('I read the file.')
            : [toolCall(`r${call}`, 'read', { path: 'a.md' }), finish('tool-calls')]
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } }),
      { tools: [readTool] }
    )
    await promptIdle(s, '/goal Keep working')

    // Round 1's reply is new; rounds 2-4 repeat it.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'work', 'hint'])
    const hint = calls.find((call) => roundStart(call.prompt) === 4)!
    expect(JSON.stringify(hint.prompt.at(-1))).toContain('The previous 2 rounds made no observable progress')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 4,
      progressRounds: 1,
      lastStop: { code: 'no_progress' }
    })
    // One read per round, none blocked.
    expect(
      toolResults(s)
        .filter((result) => result.toolName === 'read')
        .map((result) => result.isError)
    ).toEqual([false, false, false, false])
  })

  // Breaks when a successful echo does not count, or a progressing round does not clear the count.
  it('a round with a successful non-read call clears the count', async () => {
    const { session: s, host } = await goalSession(
      [
        (prompt, call) =>
          (roundStart(prompt) ?? 1) % 3 === 0
            ? [toolCall(`e${call}`, 'echo', { value: 'x' }), finish('tool-calls')]
            : say('nothing new')
      ],
      goalPort({ defaults: { maxGoalRounds: 7 } }),
      { tools: [echoTool] }
    )
    await promptIdle(s, '/goal Keep working')

    // Rounds 3 and 6 echo; rounds 4 and 5 make none, so round 6 is a hint.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual([
      'work',
      'work',
      'work',
      'work',
      'work',
      'hint',
      'wrap-up'
    ])
    expect(lastSnapshot(host.entries)).toMatchObject({ progressRounds: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a human turn does not start the count over (spec §6.1): round 4 would be a hint and
  // the goal would stop with no_progress after it.
  it('a user message taken in between rounds starts the count over', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession([() => say('nothing new')], goalPort({ defaults: { maxGoalRounds: 5 } }))
    askAtTurnEnd(s, 3)
    await promptIdle(s, '/goal Keep working')

    // Rounds 2 and 3 repeat round 1's reply; the question comes after round 3, rounds 4 and 5 repeat it again.
    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, 2, 3, undefined, 4, 5])
    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'work', 'work', 'wrap-up'])
    expect(lastSnapshot(host.entries)).toMatchObject({ progressRounds: 1, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a reply cut off by the output limit counts as progress (spec §7.2): its text changes every round.
  it('a reply cut off by the output limit is not progress', async () => {
    const { session: s, host } = await goalSession(
      [(_prompt, call) => [...textParts('t', `part ${call}`), finish('length')]],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'hint'])
    expect(lastSnapshot(host.entries)).toMatchObject({ progressRounds: 0, lastStop: { code: 'no_progress' } })
  })

  // Breaks when the repeat count restarts every turn instead of every round: no call is ever blocked.
  it('blocks the third identical call in a round with a hint and ends the goal after the fifth', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      // The reply after call 8 keeps a broken implementation from reading forever.
      [
        (_prompt, call) =>
          call <= 8 ? [toolCall(`r${call}`, 'read', { path: 'same.md' }), finish('tool-calls')] : say('giving up')
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } }),
      { tools: [readTool] }
    )
    await promptIdle(s, '/goal Keep working')

    const reads = toolResults(s).filter((result) => result.toolName === 'read')
    expect(reads.map((result) => result.isError)).toEqual([false, false, true, true, true])
    expect(textOf(reads[2])).toMatch(/already been executed in this round/)
    expect(calls).toHaveLength(5)
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 1,
      lastStop: { code: 'no_progress', message: 'the same read call was repeated 5 times' }
    })
  })

  // Breaks when calls are counted per round instead of in a row: the last read would be the third of a.md.
  it('a different call in between starts the repeat count over', async () => {
    const { session: s } = await goalSession(
      [
        (_prompt, call) =>
          call <= 4
            ? [toolCall(`r${call}`, 'read', { path: call === 3 ? 'b.md' : 'a.md' }), finish('tool-calls')]
            : say('done')
      ],
      goalPort({ defaults: { maxGoalRounds: 1 } }),
      { tools: [readTool] }
    )
    await promptIdle(s, '/goal Keep working')

    const reads = toolResults(s).filter((result) => result.toolName === 'read')
    // Each read ran and returned its file; a blocked one would carry the block reason instead.
    expect(reads.map(textOf)).toEqual(['contents of a.md', 'contents of a.md', 'contents of b.md', 'contents of a.md'])
  })
})

/** Every round asks one question, then replies. */
const askEachRound = [
  (prompt: LanguageModelV3Prompt, call: number) =>
    roundStart(prompt) === undefined
      ? say(`reply ${call}`)
      : [
          toolCall(`q${call}`, 'AskUserQuestion', {
            questions: [
              {
                question: 'Which?',
                header: 'Pick',
                options: [
                  { label: 'A', description: 'a' },
                  { label: 'B', description: 'b' }
                ]
              }
            ]
          }),
          finish('tool-calls')
        ]
]

describe('goal stops for people, errors and aborts', () => {
  it.each([
    ['denied', 'approval_denied'],
    ['unavailable', 'awaiting_approval']
  ] as const)('an approval %s in a goal round blocks the goal with %s when that round ends', async (kind, code) => {
    const { port, tool } = approvals(kind)
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      [
        (prompt, call) =>
          roundStart(prompt) === undefined
            ? say(`reply ${call}`)
            : [toolCall(`k${call}`, 'risky', {}), finish('tool-calls')]
      ],
      port,
      { tools: [tool] }
    )
    await promptIdle(s, '/goal Keep working')

    expect(calls).toHaveLength(2)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', roundsStarted: 1, lastStop: { code } })
  })

  // Breaks when an approval event outside a goal round stops the goal: the goal would end before round 1.
  it('an approval denied in a human turn does not stop the goal', async () => {
    const { port, tool } = approvals('denied', { defaults: { maxGoalRounds: 2 } })
    const { session: s, host } = await goalSession(
      [
        () => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
        () => [toolCall('k1', 'risky', {}), finish('tool-calls')],
        working
      ],
      port,
      { tools: [tool] }
    )
    await promptIdle(s, 'please do g')
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })

  it('a question the user dismisses in a goal round blocks the goal with needs_user_input', async () => {
    const { session: s, host } = await goalSession(askEachRound, goalPort(), {
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'declined' }) })]
    })
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, lastStop: { code: 'needs_user_input' } })
  })

  it('a question nobody can answer does not stop the goal', async () => {
    const { session: s, host } = await goalSession(askEachRound, goalPort({ defaults: { maxGoalRounds: 3 } }), {
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'unavailable' }) })]
    })
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  it('a failed model request blocks the goal with provider_error and the provider message', async () => {
    const { session: s, host } = await goalSession([
      (_prompt, call) => (call === 2 ? [{ type: 'error', error: new Error('upstream exploded') }] : say('one'))
    ])
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 2,
      lastStop: { code: 'provider_error', message: 'upstream exploded' }
    })
  })

  // Breaks when any failing turn stops an active goal: one restored from the transcript is not
  // armed, so an unrelated human turn that fails would mark it blocked.
  it('a failed model request in a human turn leaves an unarmed goal alone', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort(), cwd)
    const {
      session: s,
      host,
      calls
    } = await goalSession([() => [{ type: 'error', error: new Error('upstream exploded') }]], goalPort(), {
      cwd,
      transcript
    })
    await promptIdle(s, 'hello')
    await s.prompt('/goal')

    expect(calls).toHaveLength(1)
    expect(snapshots(host.entries)).toEqual([])
    expect(notices(host.entries)).toEqual(['Goal: Keep working\nPhase: active · disarmed\nRounds: 1/100 · Tokens: 0'])
  })

  // Breaks when any aborted run pauses an active goal: one restored from the transcript is not armed,
  // so aborting an unrelated human turn would mark it paused.
  it('aborting a human turn leaves an unarmed goal alone', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort(), cwd)
    const { session: s, host, held } = await heldGoalSession(goalPort(), { cwd, transcript })
    const run = s.prompt('hello')
    await held.started(1)
    await s.abort()
    await run
    await s.prompt('/goal')

    expect(held.aborted(1)).toBe(true)
    expect(snapshots(host.entries)).toEqual([])
    expect(notices(host.entries)).toEqual(['Goal: Keep working\nPhase: active · disarmed\nRounds: 1/100 · Tokens: 0'])
  })

  // Breaks when the abort is handled only at agent_before_settle, which Pi skips after session.abort():
  // the goal would stay armed, and the next message's settle would start round 2.
  it('aborting the run pauses the goal, and the next message does not continue it', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Keep working')
    await held.started(1)
    await s.abort()
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'paused',
      roundsStarted: 1,
      lastStop: { code: 'aborted' }
    })

    held.release()
    await s.prompt('hello')
    expect(rounds(host.entries)).toHaveLength(1)
    expect(held.calls.length).toBe(2)
  })

  // Breaks when continuation_rejected wins over the abort: an abort during the settle leaves the
  // goal's next round reserved, and the goal would end blocked instead of paused.
  it('aborting while the goal continues the run pauses it', async () => {
    const user: { session?: AgentSession } = {}
    const abortAtSettle: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', () => {
        // Not awaited: abort() waits for the run, which waits for this handler.
        void user.session!.abort()
      })
    }
    const { session: s, host, calls } = await goalSession([working], goalPort(), { laterExtensions: [abortAtSettle] })
    user.session = s
    await promptIdle(s, '/goal Keep working')
    expect(calls).toHaveLength(1)
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'paused',
      roundsStarted: 1,
      lastStop: { code: 'aborted' }
    })
  })

  // Breaks when decide() never asks the port: the goal would open round 2 while subagents still run.
  it('a host reporting running subagents ends the goal after the round with waiting_subagents', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ hasRunningSubagents: () => true }))
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 1,
      lastStop: { code: 'waiting_subagents' }
    })
    expect(calls).toHaveLength(1)
  })
})

/** Each round reads the goal, sends update_goal with `update(goal)` when it returns arguments, then replies. */
function eachRound(update: (goal: GoalSnapshot) => Record<string, unknown> | undefined) {
  return (prompt: LanguageModelV3Prompt, call: number) => {
    if (roundStart(prompt) !== undefined) return [toolCall(`g${call}`, 'get_goal', {}), finish('tool-calls')]
    const last = prompt.at(-1)
    const afterGetGoal =
      last?.role === 'tool' && last.content.some((part) => part.type === 'tool-result' && part.toolName === 'get_goal')
    const { goal } = readGoal(prompt)
    const args = afterGetGoal && goal ? update(goal) : undefined
    return args
      ? [
          toolCall(`u${call}`, 'update_goal', { goal_id: goal!.id, revision: goal!.revision, ...args }),
          finish('tool-calls')
        ]
      : say(`reply ${call}`)
  }
}
const updates = (s: AgentSession) => toolResults(s).filter((result) => result.toolName === 'update_goal')

describe('goal self-reports', () => {
  // Breaks when the fallback skips a check: round 1 would complete with no progress, round 2 without evidence.
  it('without a verifier, complete needs a round that progressed and evidence', async () => {
    const { session: s, host } = await goalSession([
      eachRound((goal) => ({ action: 'complete', evidence: goal.roundsStarted === 2 ? '' : 'the docs gate passes' }))
    ])
    await promptIdle(s, '/goal Keep working')

    const attempts = updates(s)
    expect(attempts.map((result) => result.isError)).toEqual([true, true, false])
    expect(textOf(attempts[0])).toMatch(/No round of this goal changed anything yet/)
    expect(textOf(attempts[1])).toMatch(/complete needs evidence/)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete', lastStop: { code: 'complete' } })
    expect(rounds(host.entries)).toHaveLength(3)
  })

  // Breaks when not_met lets the goal complete, impossible does not block it, or the verifier gets no conversation.
  it('a verifier that says not_met keeps the goal open with its reason; impossible blocks it', async () => {
    const verdicts: Array<'not_met' | 'impossible'> = ['not_met', 'impossible']
    const seen: string[] = []
    const port = goalPort({
      verify: {
        verify: async ({ messages }) => {
          seen.push(JSON.stringify(messages))
          return { verdict: verdicts.shift()!, reason: 'tests are red' }
        }
      }
    })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')

    const [notMet, impossible] = updates(s)
    expect(notMet.isError).toBe(true)
    expect(textOf(notMet)).toBe('Not complete yet: tests are red')
    expect(impossible.isError).toBe(false)
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 2,
      lastStop: { code: 'model_blocked', message: 'tests are red' }
    })
    // The verifier gets the session's conversation, round prompt included.
    expect(seen[0]).toContain('<goal_round>')
  })

  // Breaks when a verifier that throws lets the completion through.
  it('a verifier that throws does not pass the completion', async () => {
    const port = goalPort({
      defaults: { maxGoalRounds: 1 },
      verify: {
        verify: async () => {
          throw new Error('evaluator offline')
        }
      }
    })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')

    const [attempt] = updates(s)
    expect(attempt.isError).toBe(true)
    expect(textOf(attempt)).toContain('evaluator offline')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'round_limit' } })
  })

  // Breaks without the revision check after the verifier's await: the goal would complete under an objective nobody verified.
  it('a goal edited while the verifier runs is not completed by that call', async () => {
    const user: { session?: AgentSession } = {}
    let edited = false
    const port = goalPort({
      verify: {
        verify: async () => {
          if (!edited) {
            edited = true
            await user.session!.prompt('/goal edit Ship v2 instead')
          }
          return { verdict: 'met', reason: 'ok' }
        }
      }
    })
    const opened = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    user.session = opened.session
    await promptIdle(opened.session, '/goal Ship v1')

    const [stale, completed] = updates(opened.session)
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toMatch(/Stale goal reference/)
    expect(completed.isError).toBe(false)
    expect(lastSnapshot(opened.host.entries)).toMatchObject({ objective: 'Ship v2 instead', phase: 'complete' })
  })

  // Breaks when /goal pause treats a complete goal like an open one and reopens it as paused.
  it('/goal pause leaves a complete goal complete', async () => {
    const port = goalPort({ verify: { verify: async () => ({ verdict: 'met', reason: 'ok' }) } })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete' })

    await s.prompt('/goal pause')
    expect(notices(host.entries).at(-1)).toBe('the goal is complete; create a new one')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete' })
  })

  // Breaks when create() keeps the finished goal's round open: that round's last reply would count as
  // progress for the new goal, which could then complete in its first round without doing anything.
  it('a goal created after the last one completed mid-round gets no progress from that round', async () => {
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))])
    let created = false
    s.subscribe((event) => {
      if (event.type !== 'turn_end' || created) return
      if (!event.toolResults.some((result) => result.toolName === 'update_goal' && !result.isError)) return
      created = true
      void s.prompt('/goal Ship v2')
    })
    await promptIdle(s, '/goal Ship v1')

    // Ship v1 completes in round 2; Ship v2's round 1 has only read the goal when it tries.
    expect(updates(s).map((result) => result.isError)).toEqual([true, false, true, false])
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Ship v2', phase: 'complete', roundsStarted: 2 })
  })

  // Breaks when the threshold is skipped, or counts reports that are not in consecutive rounds.
  it('blocked is accepted only after three consecutive goal rounds report it', async () => {
    const { session: s, host } = await goalSession(
      [
        eachRound((goal) =>
          goal.roundsStarted === 2 ? undefined : { action: 'blocked', blocked_reason: 'the API key is missing' }
        )
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    await promptIdle(s, '/goal Keep working')

    // Round 2 reports nothing, so round 3 starts the count over.
    const attempts = updates(s)
    expect(attempts.map((result) => result.isError)).toEqual([true, true, true, false])
    expect(textOf(attempts[0])).toBe(
      'Keep trying; if the same condition still blocks you in round 3, report it again (1/3).'
    )
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 5,
      lastStop: { code: 'model_blocked', message: 'the API key is missing' }
    })
  })

  // Breaks when a human turn or a user edit does not start the blocked count over (spec §7.5).
  it.each([
    ['a user message', (s: AgentSession) => s.prompt('a question from the user', { streamingBehavior: 'followUp' })],
    ['a /goal edit', (s: AgentSession) => s.prompt('/goal edit Keep working, differently')],
    ['a /goal rounds change', (s: AgentSession) => s.prompt('/goal rounds 20')],
    ['a /goal budget change', (s: AgentSession) => s.prompt('/goal budget 100000')]
  ])('%s between reports starts the blocked count over', async (_name, interject) => {
    const opened = await goalSession(
      [eachRound(() => ({ action: 'blocked', blocked_reason: 'the API key is missing' }))],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    const { session: s, host } = opened
    let done = false
    s.subscribe((event) => {
      // After round 2's reply and before its settle.
      if (event.type !== 'turn_end' || event.toolResults.length > 0 || done || rounds(host.entries).length !== 2) return
      done = true
      void interject(s)
    })
    await promptIdle(s, '/goal Keep working')

    expect(updates(s).map((result) => result.isError)).toEqual([true, true, true, true, false])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 5, lastStop: { code: 'model_blocked' } })
  })

  // Breaks when the round threshold also applies in a human turn, where a person is there to resume.
  it('in a human turn blocked is accepted at once', async () => {
    const { session: s, host } = await goalSession([
      () => [toolCall('c', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCall('b', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: 1,
          action: 'blocked',
          blocked_reason: 'the API key is missing'
        }),
        finish('tool-calls')
      ],
      () => say('Blocked.')
    ])
    await s.prompt('please do g')

    expect(updates(s).map((result) => result.isError)).toEqual([false])
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 0,
      lastStop: { code: 'model_blocked' }
    })
  })
})
