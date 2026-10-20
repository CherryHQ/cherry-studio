import { describe, expect, it, vi } from 'vitest'

import { assistantTexts, callTool, holds, reply } from '../../src/contract/fixtures'
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

  // Catches a repeated stop request that stops whatever turn runs now (R5): its record was deduplicated but its stop
  // was not, so the host repeating a person's stop aborted the turn they started afterwards.
  it('a repeated userStop never stops a later turn', async () => {
    const hold = holds()
    const w = world({ extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'first' }), callTool('hold', { id: 'second' }), reply('second done')])
    await w.fake.sendUser(t, 'first')
    await hold.started('first')
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    expect((await w.read(t)).live.runEnd?.outcome).toBe('aborted')
    await w.fake.sendUser(t, 'second')
    await hold.started('second')
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    hold.release('second')
    await w.fake.settle()
    const facts = await w.read(t)
    expect(facts.live.runEnd?.outcome).toBe('completed')
    expect(records(facts, 'turn-stop')).toHaveLength(1)
  })

  // Catches a stop a crash cut between its record and the stop itself staying lost: the repeated request must still
  // stop the turn the record names.
  it('a repeated userStop after a crash stops the turn the first one named', async () => {
    const hold = holds()
    let crashed = false
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      wrapCall: (ports) => ({
        ...ports,
        turns: {
          ...ports.turns,
          stop: (...args: Parameters<typeof ports.turns.stop>) => {
            if (!crashed) {
              crashed = true
              w.fake.crashAt(1)
            }
            return ports.turns.stop(...args)
          }
        }
      })
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'first' }), reply('never')])
    await w.fake.sendUser(t, 'first')
    await hold.started('first')
    void w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    await vi.waitFor(() => expect(crashed).toBe(true))
    await w.fake.whenCrashed()
    await w.fake.restart()
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    await w.fake.settle()
    const facts = await w.read(t)
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    expect(records(facts, 'turn-stop')).toHaveLength(1)
    expect(assistantTexts(facts)).not.toContain('never')
  })
})
