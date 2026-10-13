import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  askAtTurnEnd,
  goalPort,
  goalSession,
  lastSnapshot,
  notices,
  promptIdle,
  rounds,
  roundStart,
  say,
  toolCall,
  working
} from './goalSupport'
import { finish, MODEL, textParts } from './support'
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
  // Breaks when a read counts as progress: the goal would run to its cap.
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
})
