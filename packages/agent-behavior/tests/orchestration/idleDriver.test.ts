import { describe, expect, it } from 'vitest'

import type { ThreadId } from '@cherrystudio/agent-runtime'

import { callTool, childSpec, holds, type Holds, latch, reply } from '../../src/contract/fixtures'
import { ensureDriver } from '../../src/core/driver/jobs'
import { callKeyOf, ENTRY_KINDS } from '../../src/core/facts'
import { admittedRounds, currentGoal } from '../../src/core/goal/goalHistory'
import { keys } from '../../src/core/keys'
import { pendingResults } from '../../src/core/subagents/subagentLedger'
import type { BoundPorts, StartResult } from '../../src/ports/harness'
import { markers, records, type World, world, wrapJob } from './world'

/**
 * Driver ports that let a person's message start a run right before the driver's first commit, and that record what
 * `Turns.start` answers; `hold` keeps the person's run going until the driver was refused once.
 */
function interjecting(hold: Holds) {
  let person: (() => Promise<void>) | undefined
  const answers: StartResult[] = []
  const wrapBound = (ports: BoundPorts): BoundPorts => ({
    ...ports,
    ledger: {
      ...ports.ledger,
      transact: async (thread, decide) => {
        const run = person
        person = undefined
        await run?.()
        return ports.ledger.transact(thread, decide)
      }
    },
    turns: {
      ...ports.turns,
      start: async (thread, input, key) => {
        const answer = await ports.turns.start(thread, input, key)
        answers.push(answer)
        if (answer === 'busy') hold.release('person')
        return answer
      }
    }
  })
  return {
    wrap: wrapJob('idle-driver', wrapBound),
    answers,
    before(w: World, thread: ThreadId) {
      person = async () => {
        await w.fake.sendUser(thread, 'person first')
        await hold.started('person')
      }
    }
  }
}
/** A background child whose first run ended, recorded the way the report job records it, and the driver woken. */
async function finishBackgroundRun(w: World, t: ThreadId): Promise<void> {
  const spec = childSpec('background', 'scan')
  await w.enter(t, (_entries, ports) =>
    ports.ledger.transact(t, () => ({
      ops: [{ type: 'spawn-child', spec, key: keys.subagentSpawn(callKeyOf('c')) }],
      effects: [],
      result: null
    }))
  )
  const child = [...(await w.read(t)).children.keys()][0]
  const ended = { ...spec.record, sessionId: child, status: 'finished' as const, outcome: 'completed' as const }
  await w.enter(t, (_entries, ports) =>
    ports.ledger.transact(t, (facts) => ({
      ops: [
        {
          type: 'append-record',
          thread: t,
          record: { type: 'subagent-run', value: ended },
          key: keys.subagentEnd(child, 1)
        },
        ensureDriver(facts)
      ],
      effects: [],
      result: null
    }))
  )
}
const ONE_ROUND = { goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 } }

describe('idle driver', () => {
  // Catches a driver that never admits its rounds, keeps going past the goal's stop, or never exits (D38, H4), and a
  // context filter that hides a round from its own first request until the driver admits it (C1).
  it('starts and admits goal rounds until the goal stops, then exits', async () => {
    const w = world({ settings: { goalDefaults: { maxGoalRounds: 2, maxGoalRoundsCeiling: 50, blockedAfter: 3 } } })
    const t = await w.fake.createThread()
    w.fake.script(t, [reply('one'), reply('two')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    const facts = await w.read(t)
    const rounds = markers(facts, 'goal-round').map(({ marker }) => marker.round)
    expect(rounds.map(({ round, kind }) => [round, kind])).toEqual([
      [1, 'work'],
      [2, 'wrap-up']
    ])
    expect([...admittedRounds(facts.history)]).toEqual(rounds.map(({ id }) => id))
    expect(currentGoal(facts.history)?.lastStop?.code).toBe('round_limit')
    expect(records(facts, 'idle-driver-exit').map(({ value }) => value.generation)).toEqual([0])
    expect(w.host.emitted.filter((event) => event.type === 'goal-round')).toHaveLength(2)
    // One request per round: each must see that round's marker.
    const requests = w.fake.requestLog(t)
    expect(markers(facts, 'goal-round').map((round, at) => requests[at]?.includes(round.id))).toEqual([true, true])
  })

  // Catches a notification refused as busy being dropped or ending the driver (Stage B Task 10 carry): it must wait
  // for the person's run and then deliver, once.
  it('delivers a result after the run that made its start busy', async () => {
    const hold = holds()
    const person = interjecting(hold)
    const w = world({ wrap: person.wrap, extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'person' }), reply('answered the person'), reply('read the result')])
    person.before(w, t)
    await finishBackgroundRun(w, t)
    await w.fake.settle()
    const history = (await w.read(t)).history
    const asked = history.findIndex((entry) => entry.kind === 'user')
    const delivered = history.findIndex(
      (entry) => entry.kind === 'marker' && entry.marker.type === 'subagent-notification'
    )
    expect(person.answers).toEqual(['busy', 'started'])
    expect(asked).toBeGreaterThanOrEqual(0)
    expect(delivered).toBeGreaterThan(asked)
    expect(markers(await w.read(t), 'subagent-notification')).toHaveLength(1)
  })

  // Catches a round admitted although Turns refused it as busy: the goal would count a round that never ran (R1, R2).
  it('admits no round that Turns refused as busy', async () => {
    const hold = holds()
    const person = interjecting(hold)
    const w = world({ wrap: person.wrap, settings: ONE_ROUND, extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'person' }), reply('answered the person'), reply('round 1 done')])
    person.before(w, t)
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    const facts = await w.read(t)
    const started = new Set(markers(facts, 'goal-round').map(({ marker }) => marker.round.id))
    expect(person.answers[0]).toBe('busy')
    expect([...admittedRounds(facts.history)].filter((id) => !started.has(id))).toEqual([])
    expect(currentGoal(facts.history)?.roundsStarted).toBe(1)
  })

  // Catches a driver that decides again while its notification still waits behind a failed run's leftovers: it would
  // start the same spent key over and over without waiting (G-C3).
  it('waits for a notification queued behind leftovers instead of deciding again', async () => {
    const hold = holds()
    const answers: StartResult[] = []
    const waiting = latch()
    const counted = (ports: BoundPorts): BoundPorts => ({
      ...ports,
      turns: {
        ...ports.turns,
        start: async (thread, input, key) => {
          if (answers.length >= 3) throw new Error('the driver keeps starting the same input')
          const answer = await ports.turns.start(thread, input, key)
          answers.push(answer)
          return answer
        }
      },
      waits: {
        ...ports.waits,
        untilDone: (thread, key) => {
          waiting.release()
          return ports.waits.untilDone(thread, key)
        }
      }
    })
    const w = world({ wrap: wrapJob('idle-driver', counted), extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('hold', { id: 'go' }),
      { error: 'boom' },
      { error: 'boom again' },
      reply('read the result'),
      reply('ok')
    ])
    await w.fake.sendUser(t, 'go')
    await hold.started('go')
    await w.fake.sendUser(t, 'follow')
    hold.release('go')
    await w.enter(t, (_entries, ports) => ports.waits.untilIdle(t))
    await finishBackgroundRun(w, t)
    // The notification queues behind 'follow', which fails too and leaves it queued until the next input drains it.
    await Promise.race([waiting.promise, w.fake.settle()])
    // Give a driver that took the queued input for done the time to decide again.
    await w.enter(t, (_entries, ports) => ports.waits.untilIdle(t))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await w.fake.sendUser(t, 'nudge')
    await w.fake.settle()
    expect(answers).toEqual(['queued'])
    expect(markers(await w.read(t), 'subagent-notification')).toHaveLength(1)
  })

  // Catches a notification a stop withdrew offered again under its spent key once a later turn lifts the suppression
  // (I1): Turns answers 'queued' for that key without taking the input, so the driver would decide again forever.
  it('offers a notification a stop withdrew again under a new key', async () => {
    const hold = holds()
    const queued = latch()
    const personBack = latch()
    let commits = 0
    const starts: StartResult[] = []
    const watched = (ports: BoundPorts): BoundPorts => ({
      ...ports,
      ledger: {
        ...ports.ledger,
        transact: (thread, decide) => {
          commits += 1
          if (commits > 30) return Promise.reject(new Error('the driver keeps deciding'))
          return ports.ledger.transact(thread, decide)
        }
      },
      turns: {
        ...ports.turns,
        start: async (thread, input, key) => {
          const answer = await ports.turns.start(thread, input, key)
          starts.push(answer)
          if (answer === 'queued') queued.release()
          return answer
        }
      },
      // The driver decides again only once the person's next turn is running.
      waits: {
        ...ports.waits,
        untilDone: async (thread, key) => {
          await ports.waits.untilDone(thread, key)
          await personBack.promise
        }
      }
    })
    const w = world({ wrap: wrapJob('idle-driver', watched), extra: (p) => p.tools.register(hold.tool) })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('hold', { id: 'go' }),
      { error: 'boom' },
      callTool('hold', { id: 'new' }),
      reply('answered'),
      reply('read the result')
    ])
    await w.fake.sendUser(t, 'go')
    await hold.started('go')
    await w.fake.sendUser(t, 'follow')
    hold.release('go')
    await w.enter(t, (_entries, ports) => ports.waits.untilIdle(t))
    // 'follow' waits behind the failed run, so the notification queues behind it until the stop withdraws both.
    await finishBackgroundRun(w, t)
    await queued.promise
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    await w.fake.sendUser(t, 'new')
    await hold.started('new')
    personBack.release()
    hold.release('new')
    await w.fake.settle()
    const facts = await w.read(t)
    expect(starts).toEqual(['queued', 'started'])
    expect(markers(facts, 'subagent-notification')).toHaveLength(1)
    expect(pendingResults(facts.history)).toEqual([])
  })

  // Catches admission by position (R1): a round reserved before the person edited the goal must not count, and the
  // run it started must stop.
  it('withdraws and stops a round the goal changed under, then runs the new one', async () => {
    const hold = holds()
    let edit: (() => Promise<unknown>) | undefined
    const afterStart = (ports: BoundPorts): BoundPorts => ({
      ...ports,
      turns: {
        ...ports.turns,
        start: async (thread, input, key) => {
          const started = await ports.turns.start(thread, input, key)
          const run = input.kind === ENTRY_KINDS.goalRound ? edit : undefined
          edit = undefined
          await run?.()
          return started
        }
      }
    })
    const w: World = world({
      settings: ONE_ROUND,
      wrap: wrapJob('idle-driver', afterStart),
      extra: (p) => p.tools.register(hold.tool)
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'r1' }), reply('v2 done')])
    edit = () => w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'edit a sharper objective', 'cmd-edit'))
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    const facts = await w.read(t)
    const [withdrawn, taken] = markers(facts, 'goal-round').map(({ marker }) => marker.round)
    expect([withdrawn.revision, taken.revision]).toEqual([1, 2])
    expect([...admittedRounds(facts.history)]).toEqual([taken.id])
    // The stop cut the withdrawn round's call: the hold tool reports an aborted call as an error.
    expect(facts.history.find((entry) => entry.kind === 'tool-result')).toMatchObject({
      text: 'held r1',
      isError: true
    })
    expect(currentGoal(facts.history)?.roundsStarted).toBe(1)
  })
})
