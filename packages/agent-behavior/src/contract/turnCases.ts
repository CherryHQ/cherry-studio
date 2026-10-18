import { check, same } from './assert'
import { assistantTexts, callTool, holds, key, markersWith, read, reply, status, userCount } from './fixtures'
import type { ContractCase } from './harness'

export const turnCases: readonly ContractCase[] = [
  // Catches a duplicate input for a repeated key, or a busy rejection that burns the key (DP K8).
  {
    name: 'start runs an idle conversation once per key and rejects a busy one without a record',
    covers: ['turns.start', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const start = (label: string) => h.withCall(t, (p) => p.turns.start(t, status(label), key(label)))
      h.script(t, [reply('ok'), callTool('hold', { id: 'c8' }), reply('held'), reply('later')])
      check((await start('c8-idle')) === 'started', 'an idle conversation must start the turn')
      await h.settle()
      check((await start('c8-idle')) === 'started', 'the same key must return the original admission')
      await h.settle()
      check(markersWith(await read(h, t), key('c8-idle')).length === 1, 'the same key must never add a second input')
      await h.sendUser(t, 'busy')
      await hold.started('c8')
      check((await start('c8-busy')) === 'busy', 'a conversation with an active run must reject the turn')
      check(!(await read(h, t)).keysSeen.has(key('c8-busy')), 'a rejected turn must leave no record')
      hold.release('c8')
      await h.settle()
      check((await start('c8-busy')) === 'started', 'a key rejected as busy must stay usable')
      await h.settle()
      check(markersWith(await read(h, t), key('c8-busy')).length === 1, 'the reused key must start exactly one turn')
    }
  },
  // Catches input jumping ahead of a failed run's leftovers, or a withdrawn turn that still runs (DP K6, G2).
  {
    name: 'start queues behind inbox items a failed run left, and retract withdraws it',
    covers: ['turns.start', 'turns.retract', 'waits.untilTurnEnd', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const start = (label: string) => h.withCall(t, (p) => p.turns.start(t, status(label), key(label)))
      const retract = (label: string) => h.withCall(t, (p) => p.turns.retract(t, key(label)))
      h.script(t, [
        callTool('hold', { id: 'c9-a' }),
        reply('a done'),
        callTool('hold', { id: 'c9-b' }),
        { error: 'boom' },
        callTool('hold', { id: 'c9-c' }),
        reply('follow done')
      ])
      check((await start('c9-a')) === 'started', 'an idle conversation must start the turn')
      await hold.started('c9-a')
      check((await retract('c9-a')) === 'already-started', 'retracting a running turn must report it started')
      hold.release('c9-a')
      await h.settle()
      check((await retract('c9-a')) === 'settled', 'retracting a finished turn must report it settled')
      check((await retract('c9-never')) === 'not-found', 'retracting an unknown key must report not-found')
      await h.sendUser(t, 'go')
      await hold.started('c9-b')
      await h.sendUser(t, 'follow')
      const ended = h.withCall(t, (p) => p.waits.untilTurnEnd(t))
      hold.release('c9-b')
      await ended
      check((await read(h, t)).live.runEnd?.outcome === 'error', 'the scripted error must fail the run')
      check(
        (await start('c9-q')) === 'queued',
        'input to an idle conversation holding inbox items must queue behind them'
      )
      await hold.started('c9-c')
      check((await retract('c9-q')) === 'withdrawn', 'a queued turn must be withdrawable')
      hold.release('c9-c')
      await h.settle()
      check(markersWith(await read(h, t), key('c9-q')).length === 0, 'a withdrawn turn must never run')
      check((await start('c9-q')) === 'queued', 'a withdrawn key is spent: start returns its original admission')
      await h.settle()
      check(markersWith(await read(h, t), key('c9-q')).length === 0, 'a spent key must not start a turn')
    }
  },
  // Catches a stop that returns before the conversation is idle or lets queued input run (DP K7).
  {
    name: 'stop aborts the run, withdraws queued input and resolves when idle',
    covers: ['turns.stop', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'c10' }), reply('never')])
      await h.sendUser(t, 'go')
      await hold.started('c10')
      await h.sendUser(t, 'queued')
      await h.withCall(t, (p) => p.turns.stop(t, 'user'))
      const facts = await read(h, t)
      check(facts.live.idle, 'stop must resolve only once the conversation is idle')
      check(facts.live.runEnd?.outcome === 'aborted', 'a stopped run must end aborted')
      await h.settle()
      const after = await read(h, t)
      check(userCount(after) === 1, 'stop must withdraw queued input')
      check(!assistantTexts(after).includes('never'), 'a stopped run must make no further model request')
    }
  },
  // Catches waits that resolve early, letting the driver decide on a still-running turn (design §6.1 H5).
  {
    name: 'waits resolve only when the run ends',
    covers: ['waits.untilIdle', 'waits.untilTurnEnd', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'c15' }), reply('done')])
      await h.withCall(t, (p) => p.waits.untilIdle(t))
      await h.sendUser(t, 'go')
      await hold.started('c15')
      const ended = { idle: false, turnEnd: false }
      const idle = h
        .withCall(t, (p) => p.waits.untilIdle(t))
        .then(() => {
          ended.idle = true
        })
      const turnEnd = h
        .withCall(t, (p) => p.waits.untilTurnEnd(t))
        .then(() => {
          ended.turnEnd = true
        })
      await read(h, t)
      await read(h, t)
      same(ended, { idle: false, turnEnd: false }, 'waits must not resolve while the run is active')
      hold.release('c15')
      await Promise.all([idle, turnEnd])
    }
  }
]
