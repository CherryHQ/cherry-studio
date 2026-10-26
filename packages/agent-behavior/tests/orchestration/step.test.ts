import { describe, expect, it } from 'vitest'

import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import { callTool, childSpec, holds, message, reply } from '../../src/contract/fixtures'
import { turnInput, type TxOp } from '../../src/core/decisions'
import { callKeyOf } from '../../src/core/facts'
import { keys } from '../../src/core/keys'
import { MAX_SUBAGENT_REQUESTS } from '../../src/core/subagents/subagentText'
import { gatherInputs, step } from '../../src/orchestration/step'
import type { BoundPorts } from '../../src/ports/harness'
import { markers, records, world } from './world'

const notice = (thread: ThreadId, label: string): TxOp => ({
  type: 'append-record',
  thread,
  record: { type: 'goal-notice', value: { text: label, level: 'info' } },
  key: keys.goalNotice(label)
})

describe('step', () => {
  // Catches a rerun that writes a record twice, or two operations of one step that share a key both landing (I4).
  it('applies each key once, across reruns and within a step', async () => {
    const w = world()
    const t = await w.fake.createThread()
    const decide = () => ({ ops: [notice(t, 'a'), notice(t, 'a'), notice(t, 'b')], effects: [], result: null })
    await w.enter(t, (_entries, ports) => step({ ports, host: w.host }, t, decide))
    await w.enter(t, (_entries, ports) => step({ ports, host: w.host }, t, decide))
    expect(records(await w.read(t), 'goal-notice').map(({ value }) => value.text)).toEqual(['a', 'b'])
  })

  // Catches effects run before their commit: a user stop that stops the turn before its record lands loses the
  // suppression when the process dies in between (R5).
  it('runs the effects after the commit', async () => {
    const hold = holds()
    const order: string[] = []
    const spy = (ports: BoundPorts): BoundPorts => ({
      ...ports,
      turns: {
        ...ports.turns,
        stop: async (thread, cause) => {
          order.push(`stop:${(await ports.ledger.read(thread)).keysSeen.has(keys.turnStop('r1'))}`)
          return ports.turns.stop(thread, cause)
        }
      }
    })
    const w = world({ extra: (p) => p.tools.register(hold.tool), wrapCall: spy })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'h' }), reply('never')])
    await w.fake.sendUser(t, 'go')
    await hold.started('h')
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'r1'))
    const facts = await w.read(t)
    expect(order).toEqual(['stop:true'])
    expect(facts.live.runEnd?.outcome).toBe('aborted')
  })

  // Catches a driver that cannot tell a turn was refused: it would admit a round that never started (R1, R2).
  it("reports Turns' answer to the step's start", async () => {
    const hold = holds()
    const w = world({ extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'h' }), reply('done'), reply('notified')])
    await w.fake.sendUser(t, 'go')
    await hold.started('h')
    const input = turnInput({ type: 'subagent-status' }, 'status')
    const start = () =>
      w.enter(t, (_entries, ports) =>
        step({ ports, host: w.host }, t, () => ({
          ops: [],
          effects: [{ type: 'start-turn', thread: t, input, key: keys.subagentStatus('item-x' as ItemId) }],
          result: null
        }))
      )
    expect((await start()).started).toBe('busy')
    hold.release('h')
    await w.fake.settle()
    expect((await start()).started).toBe('started')
  })

  // Catches the host showing a stale subagent list after a spawn, or a view event on steps that touch no child.
  it('shows the subagent views after a step that touches a child, and only then', async () => {
    const w = world()
    const t = await w.fake.createThread()
    const spawn = keys.subagentSpawn(callKeyOf('call-1'))
    const { spawned } = await w.enter(t, (_entries, ports) =>
      step({ ports, host: w.host }, t, () => ({
        ops: [{ type: 'spawn-child', spec: childSpec('background', 'scan'), key: spawn }],
        effects: [],
        result: null
      }))
    )
    await w.enter(t, (_entries, ports) =>
      step({ ports, host: w.host }, t, () => ({ ops: [notice(t, 'n')], effects: [], result: null }))
    )
    expect(w.host.emitted).toEqual([
      {
        type: 'subagents',
        thread: t,
        views: [{ sessionId: spawned[0].child, parentToolCallId: 'scan', description: 'scan', status: 'running' }]
      }
    ])
  })

  // Catches inputs that read only the thread's own approval outcomes: a child waiting for a person would never show
  // as waiting, and its slot and status text would be wrong (A-d).
  it("gathers the children's approval outcomes with the thread's", async () => {
    const w = world()
    const t = await w.fake.createThread()
    const { spawned } = await w.enter(t, (_entries, ports) =>
      ports.ledger.transact(t, () => ({
        ops: [{ type: 'spawn-child', spec: childSpec('background', 'scan'), key: keys.subagentSpawn(callKeyOf('c')) }],
        effects: [],
        result: null
      }))
    )
    const child = spawned[0].child
    const ref = { thread: child, key: callKeyOf(`${child}:call-1`) }
    const tool = { callId: 'call-1', callKey: ref.key, name: 'bash', args: {} }
    void w.host.approvals.ask({ call: ref, tool, presentation: 'stream' }, new AbortController().signal)
    const inputs = await w.enter(t, (_entries, ports) => gatherInputs({ ports, host: w.host }, t))
    expect(inputs.approvals).toEqual([{ call: ref, state: 'pending' }])
  })
})

describe('install', () => {
  // Catches a context filter that is not registered: a round the driver withdrew would still reach the model (D12).
  it('leaves unadmitted round markers out of model requests', async () => {
    const w = world()
    const t = await w.fake.createThread()
    const round = { id: 'goal-round:g:r1:v1:a1', goalId: 'g', revision: 1, round: 1, kind: 'work' as const }
    await w.enter(t, (_entries, ports) =>
      ports.ledger.transact(t, () => ({
        ops: [
          {
            type: 'append-quiet',
            thread: t,
            input: turnInput({ type: 'goal-round', round }, 'round'),
            key: keys.goalRound('g', 1, 1, 1)
          }
        ],
        effects: [],
        result: null
      }))
    )
    w.fake.script(t, [reply('ok')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const [marker] = markers(await w.read(t), 'goal-round')
    expect(w.fake.requestLog(t)[0]).not.toContain(marker.id)
  })

  // Catches a meter that is not registered or applied to root conversations: a child would run past its cap (D24).
  it("ends a child's run at its request cap", async () => {
    const echo = callTool('echo', { text: 'x' })
    const w = world({
      extra: (p) =>
        p.tools.register({
          name: 'echo',
          description: 'echo',
          schema: { type: 'object' },
          replay: 'safe',
          executionMode: 'sequential',
          availability: 'all',
          modelOnly: true,
          run: async () => ({ text: 'x', isError: false })
        }),
      scripts: (_thread, lineage) =>
        lineage.kind === 'subagent'
          ? [...Array.from({ length: MAX_SUBAGENT_REQUESTS }, () => echo), reply('never')]
          : []
    })
    const t = await w.fake.createThread()
    const { spawned } = await w.enter(t, (_entries, ports) =>
      ports.ledger.transact(t, () => ({
        ops: [{ type: 'spawn-child', spec: childSpec('background', 'loop'), key: keys.subagentSpawn(callKeyOf('c')) }],
        effects: [],
        result: null
      }))
    )
    const child = spawned[0].child
    const key = keys.subagentMessage(child, 1)
    const answer = await w.enter(t, async (_entries, ports) => {
      await ports.helpers.message(child, message('go'), key, 1)
      return ports.helpers.awaitAnswer(child, 1, key)
    })
    expect(answer.outcome).toBe('limit_reached')
  })
})
