import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import { goalModel, goalPort, lastSnapshot, notices, readGoal, say, snapshots, toolCall } from './goalSupport'
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
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix it', phase: expect.any(String) })
    await s.prompt('/goal rounds 2000')
    expect(notices(host.entries).at(-1)).toMatch(/between 1 and 1000/)
    await s.prompt('/goal edit    ')
    expect(notices(host.entries).at(-1)).toMatch(/1-4000/)
  })
})
