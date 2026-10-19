import { describe, expect, it } from 'vitest'

import { callTool, holds, reply } from '../../src/contract/fixtures'
import { currentGoal } from '../../src/core/goal/goalHistory'
import { markers, records, world } from './world'

describe('host entries', () => {
  // Catches a repeated `/goal` request deciding again (Stage B Task 5 carry): it would answer "a goal is already set"
  // and show the person a second notice for one command.
  it('answers a repeated /goal request with its first notice and acts once', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(
      t,
      Array.from({ length: 8 }, (_, i) => reply(`round ${i}`))
    )
    const first = await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    const again = await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    expect(again).toEqual(first)
    expect(first).toEqual({ text: 'Goal created.', level: 'info' })
    expect(records(await w.read(t), 'goal-notice')).toHaveLength(1)
    expect(w.host.emitted.filter((event) => event.type === 'goal-notice')).toHaveLength(1)
  })

  // Catches a pause that leaves the running round going, or that is not recorded as a stop (plan choice 9 of Stage B).
  it('/goal pause stops the running round after recording the stop', async () => {
    const hold = holds()
    const w = world({ extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'r1' }), reply('never')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await hold.started('r1')
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'pause', 'cmd-2'))
    await w.fake.settle()
    const facts = await w.read(t)
    expect(currentGoal(facts.history)?.phase).toBe('paused')
    expect(records(facts, 'turn-stop').map(({ value }) => value.cause)).toEqual(['goal-command'])
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    expect(markers(facts, 'goal-round')).toHaveLength(1)
  })

  // Catches an armed goal left still after the host leaves plan mode: the driver exited in plan mode and nothing
  // wakes it (Stage B review 11b).
  it('wakes the driver when the host leaves plan mode', async () => {
    const w = world({ settings: { permissionMode: 'plan' } })
    const t = await w.fake.createThread()
    w.fake.script(
      t,
      Array.from({ length: 8 }, (_, i) => reply(`round ${i}`))
    )
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    expect(markers(await w.read(t), 'goal-round')).toHaveLength(0)
    w.host.setSettings({ permissionMode: 'default' })
    await w.enter(t, (entries, ports) => entries.permissionModeChanged(ports, t))
    await w.fake.settle()
    expect(markers(await w.read(t), 'goal-round').length).toBeGreaterThan(0)
  })
})
