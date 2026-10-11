import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import {
  goalModel,
  goalNotices,
  goalPort,
  goalStates,
  lastSnapshot,
  notices,
  readGoal,
  say,
  snapshots,
  toolCall
} from './goalSupport'
import { createTestSession, finish, hostStore, streamTextPort } from './support'
import { textOf, toolResults } from './toolResults'

async function session(scripts: Parameters<typeof goalModel>[0], port = goalPort()) {
  const { model, calls } = goalModel(scripts)
  const host = hostStore()
  const runtime = await createTestSession({
    port: streamTextPort(model).port,
    extensionFactories: [createGoalExtension(port)],
    onEvent: host.onEvent
  })
  return { ...runtime, calls, host }
}

/** A session whose model call waits for `release()`, so commands can run while a turn is in flight. */
async function heldSession() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let started!: () => void
  const running = new Promise<void>((resolve) => (started = resolve))
  let signal: AbortSignal | undefined
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      signal = options.abortSignal
      started()
      await gate
      return { stream: simulateReadableStream({ chunks: say('done') }) }
    }
  })
  const host = hostStore()
  const { session: s } = await createTestSession({
    port: streamTextPort(model).port,
    extensionFactories: [createGoalExtension(goalPort())],
    onEvent: host.onEvent
  })
  return { s, host, running, release, aborted: () => signal?.aborted }
}

describe('goal tools', () => {
  it('lets the model create a goal in a human turn and read it back with the same id', async () => {
    const {
      session: s,
      host,
      calls
    } = await session([
      () => [
        toolCall('c1', 'create_goal', { objective: 'Ship the docs gate', max_goal_rounds: 5 }),
        finish('tool-calls')
      ],
      () => [toolCall('c2', 'get_goal', {}), finish('tool-calls')],
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
    const { session: s, calls } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCall('c2', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: 1,
          action: 'edit',
          objective: 'g2'
        }),
        finish('tool-calls')
      ],
      (prompt) => [
        toolCall('c3', 'update_goal', {
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
    const { session: s } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'first' }), finish('tool-calls')],
      () => [toolCall('c2', 'create_goal', { objective: 'second' }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, second] = toolResults(s)
    expect(second.isError).toBe(true)
    expect(textOf(second)).toMatch(/already/i)
  })

  it('treats empty strings and zero as omitted optional fields', async () => {
    const { session: s, calls } = await session([
      () => [
        toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: 0, budget_tokens: 0 }),
        finish('tool-calls')
      ],
      (prompt) => [
        toolCall('c2', 'update_goal', {
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
    const { session: s, host } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: -1 }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    const [created] = toolResults(s)
    expect(created.isError).toBe(true)
    expect(textOf(created)).toMatch(/between 1 and/)
    expect(snapshots(host.entries)).toHaveLength(0)
  })

  it('refuses an edit that changes nothing and appends no snapshot', async () => {
    const { session: s, host } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCall('c2', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'edit' }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, edit] = toolResults(s)
    expect(edit.isError).toBe(true)
    expect(textOf(edit)).toBe('edit needs an objective, max_goal_rounds, budget_tokens or budget_usd')
    expect(snapshots(host.entries)).toHaveLength(1)
  })

  it('resuming an active goal returns its view without a new snapshot', async () => {
    const {
      session: s,
      host,
      calls
    } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCall('c2', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'resume' }),
        finish('tool-calls')
      ],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, resumed] = toolResults(s)
    expect(resumed.isError).toBe(false)
    expect(readGoal(calls[2].prompt)).toMatchObject({ goal: { revision: 1, phase: 'active' }, activation: 'armed' })
    expect(snapshots(host.entries)).toHaveLength(1)
  })
})

describe('/goal command', () => {
  it('answers control words and edits with a notice when no goal exists, without a model turn', async () => {
    const port = goalPort()
    const host = hostStore()
    const { model, calls } = goalModel([() => say('unused')])
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createGoalExtension(port)],
      onEvent: host.onEvent
    })
    for (const command of ['pause', 'resume', 'clear', 'edit nothing', 'rounds 2000', ''])
      await s.prompt(`/goal ${command}`.trim())

    // Matching the whole list catches a command that answers with no notice, or with two.
    expect(notices(host.entries)).toEqual([
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set. Use /goal <objective> to create one.'
    ])
    expect(calls).toHaveLength(0)
  })

  it('reports a cap above the ceiling and an empty objective as errors', async () => {
    const host = hostStore()
    const { model } = goalModel([() => say('unused')])
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createGoalExtension(goalPort({ defaults: { autonomy: () => 'confirm-each-round' } }))],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Fix it')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix it', phase: 'active' })
    const before = lastSnapshot(host.entries)!
    await s.prompt('/goal rounds 2000')
    expect(goalNotices(host.entries).at(-1)).toEqual({
      text: expect.stringMatching(/between 1 and 1000/),
      level: 'error'
    })
    expect(lastSnapshot(host.entries)).toMatchObject({ revision: before.revision, maxGoalRounds: 100 })
    await s.prompt('/goal edit    ')
    expect(notices(host.entries).at(-1)).toMatch(/1-4000/)
  })

  it('edits the objective, round cap and budget of the current goal', async () => {
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal Fix it')
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
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal rounds of tests until CI passes')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'rounds of tests until CI passes' })
    await s.prompt('/goal clear')
    await s.prompt('/goal budget the release')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'budget the release' })
  })

  it('matches control words regardless of case', async () => {
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal Fix it')
    await s.prompt('/goal Pause')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'paused' })
    await s.prompt('/goal RESUME')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'active' })
  })

  it('pausing twice appends one snapshot and says the goal already is paused', async () => {
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal Fix it')
    await s.prompt('/goal pause')
    await s.prompt('/goal pause')
    expect(snapshots(host.entries).map((goal) => goal.phase)).toEqual(['active', 'paused'])
    expect(notices(host.entries).slice(-2)).toEqual(['Goal paused.', 'Goal is already paused.'])
  })

  it('reports the goal as status text', async () => {
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal Fix it')
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('Goal: Fix it\nPhase: active · armed\nRounds: 0/100 · Tokens: 0')
    await s.prompt('/goal pause')
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe(
      'Goal: Fix it\nPhase: paused (paused_by_user) · disarmed\nRounds: 0/100 · Tokens: 0'
    )
  })

  it('clearing writes a tombstone, after which the goal is gone', async () => {
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal Fix it')
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
    const { session: s, host } = await session([() => say('unused')])
    await s.prompt('/goal First')
    await s.prompt('/goal clear')
    await s.prompt('/goal Second')
    expect(snapshots(host.entries).find((goal) => goal.objective === 'Second')).toMatchObject({
      tokensUsed: 0,
      costUsed: 0
    })
  })

  it('pausing an active goal stops the running turn', async () => {
    const { s, running, release, aborted } = await heldSession()
    await s.prompt('/goal Fix it')
    const run = s.prompt('go')
    await running
    await s.prompt('/goal pause')
    expect(aborted()).toBe(true)
    release()
    await run
  })

  it('clearing a goal that is not active leaves the running turn alone', async () => {
    const { s, running, release, aborted } = await heldSession()
    await s.prompt('/goal Fix it')
    await s.prompt('/goal pause')
    const run = s.prompt('go')
    await running
    await s.prompt('/goal clear')
    expect(aborted()).toBe(false)
    release()
    await run
  })
})
