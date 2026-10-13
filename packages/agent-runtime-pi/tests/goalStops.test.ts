import { describe, expect, it } from 'vitest'

import { goalPort, goalSession, lastSnapshot, notices, promptIdle, rounds, toolCall, working } from './goalSupport'
import { finish, MODEL } from './support'
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
