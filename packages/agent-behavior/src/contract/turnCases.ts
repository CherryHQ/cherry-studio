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
  // Catches input jumping ahead of a failed run's leftovers, leftovers missing from the facts or holding untilIdle, or a withdrawn turn that still runs (DP K6, G2).
  // Premise: Durable's default `followUpMode: 'one-at-a-time'`; with 'all', `c9-q` would start with the leftover.
  {
    name: 'start queues behind inbox items a failed run left, and retract withdraws it',
    covers: ['turns.start', 'turns.retract', 'waits.untilIdle', 'tools.register'],
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
      const ended = h.withCall(t, (p) => p.waits.untilIdle(t))
      hold.release('c9-b')
      await ended
      const failed = await read(h, t)
      check(failed.live.runEnd?.outcome === 'error', 'the scripted error must fail the run')
      check(
        !failed.live.idle && failed.live.leftoverInputs === 1,
        'a failed run must leave its queued input in the inbox, reported as a leftover'
      )
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
  // Catches a stop naming a turn that reaches a later one (H2): a stop the host repeats would abort the turn a person
  // started after it.
  {
    name: 'a stop naming a turn stops that turn and never a later one',
    covers: ['turns.stop', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'first' }), callTool('hold', { id: 'second' }), reply('second done')])
      await h.sendUser(t, 'first')
      await hold.started('first')
      const turn = (await read(h, t)).history.find((entry) => entry.kind === 'user')?.id
      check(turn !== undefined, "the person's message must be in history")
      await h.withCall(t, (p) => p.turns.stop(t, 'user', turn))
      check((await read(h, t)).live.runEnd?.outcome === 'aborted', 'a stop naming the running turn must stop it')
      await h.sendUser(t, 'second')
      await hold.started('second')
      await h.withCall(t, (p) => p.turns.stop(t, 'user', turn))
      hold.release('second')
      await h.settle()
      check(
        (await read(h, t)).live.runEnd?.outcome === 'completed',
        'a stop naming an earlier turn must leave a later turn running'
      )
    }
  },
  // Catches waits that resolve at a turn boundary inside the run (Durable's generation handover after a tool round), letting the driver decide on a running run (H5).
  {
    name: 'waits resolve only when the run ends',
    covers: ['waits.untilIdle', 'waits.untilDone', 'turns.start', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'c15-a' }), callTool('hold', { id: 'c15-b' }), reply('done')])
      await h.withCall(t, (p) => p.turns.start(t, status('go'), key('c15')))
      await hold.started('c15-a')
      const ended = { idle: false, done: false }
      const idle = h
        .withCall(t, (p) => p.waits.untilIdle(t))
        .then(() => {
          ended.idle = true
        })
      const done = h
        .withCall(t, (p) => p.waits.untilDone(t, key('c15')))
        .then(() => {
          ended.done = true
        })
      await read(h, t)
      await read(h, t)
      same(ended, { idle: false, done: false }, 'waits must not resolve while a tool call runs')
      hold.release('c15-a')
      await hold.started('c15-b')
      await read(h, t)
      await read(h, t)
      same(ended, { idle: false, done: false }, 'waits must not resolve at the turn boundary after a tool round')
      hold.release('c15-b')
      await Promise.all([idle, done])
      check((await read(h, t)).live.idle, 'the conversation must be idle once both waits resolved')
    }
  },
  // Catches a wait that pends on a conversation with no run, or on an input that already ran or was never submitted,
  // which hangs every caller that waits on an idle thread.
  {
    name: 'both waits resolve immediately when the conversation is idle',
    covers: ['waits.untilIdle', 'waits.untilDone', 'turns.start'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      await h.withCall(t, (p) => Promise.all([p.waits.untilIdle(t), p.waits.untilDone(t, key('c16-none'))]))
      h.script(t, [reply('done')])
      await h.withCall(t, (p) => p.turns.start(t, status('go'), key('c16-go')))
      await h.settle()
      await h.withCall(t, (p) => Promise.all([p.waits.untilIdle(t), p.waits.untilDone(t, key('c16-go'))]))
    }
  },
  // Catches an untilDone that resolves while its input still waits behind a failed run's leftovers: the idle driver
  // would decide again on the same facts and start the same spent key without end (G-C3).
  {
    name: 'untilDone waits for a queued input to run after the inputs before it',
    covers: ['waits.untilDone', 'turns.start', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [
        callTool('hold', { id: 'd-1' }),
        { error: 'boom' },
        { error: 'boom again' },
        reply('queued done'),
        reply('nudge done')
      ])
      await h.sendUser(t, 'go')
      await hold.started('d-1')
      await h.sendUser(t, 'follow')
      hold.release('d-1')
      await h.withCall(t, (p) => p.waits.untilIdle(t))
      check((await read(h, t)).live.leftoverInputs === 1, 'the failed run must leave the follow-up queued')
      const queued = await h.withCall(t, (p) => p.turns.start(t, status('queued input'), key('d-q')))
      check(queued === 'queued', 'input behind a leftover must queue')
      let resolved = false
      const done = h
        .withCall(t, (p) => p.waits.untilDone(t, key('d-q')))
        .then(() => {
          resolved = true
        })
      // The follow-up fails too: the input stays queued with no run going, the state an idle driver would spin in.
      await h.withCall(t, (p) => p.waits.untilIdle(t))
      await read(h, t)
      await read(h, t)
      check((await read(h, t)).live.leftoverInputs === 1, 'the second failure must leave the input queued')
      check(!resolved, 'untilDone must not resolve while its input is still queued')
      await h.sendUser(t, 'nudge')
      await done
      check(
        assistantTexts(await read(h, t)).includes('queued done'),
        'untilDone must resolve only once the run that took the input has ended'
      )
    }
  },
  // Catches an untilDone that waits for an input that will never run: a withdrawn one, or one refused as busy.
  {
    name: 'untilDone resolves at once for an input that was withdrawn or refused',
    covers: ['waits.untilDone', 'turns.start', 'turns.retract', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'e-1' }), { error: 'boom' }, callTool('hold', { id: 'e-2' }), reply('done')])
      await h.sendUser(t, 'go')
      await hold.started('e-1')
      await h.sendUser(t, 'follow')
      hold.release('e-1')
      await h.withCall(t, (p) => p.waits.untilIdle(t))
      check(
        (await h.withCall(t, (p) => p.turns.start(t, status('withdrawn'), key('e-w')))) === 'queued',
        'input behind a leftover must queue'
      )
      await hold.started('e-2')
      check(
        (await h.withCall(t, (p) => p.turns.retract(t, key('e-w')))) === 'withdrawn',
        'a queued input is withdrawable'
      )
      await h.withCall(t, (p) => p.waits.untilDone(t, key('e-w')))
      check(
        (await h.withCall(t, (p) => p.turns.start(t, status('refused'), key('e-b')))) === 'busy',
        'a start while a run is active must be refused'
      )
      await h.withCall(t, (p) => p.waits.untilDone(t, key('e-b')))
      hold.release('e-2')
      await h.settle()
    }
  },
  // Catches a person's input that waits behind a run missing from the facts (Stage A review M10): the driver's
  // "the person first" rule reads it.
  {
    name: 'input a person sends during a run shows as queued until it runs',
    covers: ['ledger.read', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'm10' }), reply('first done'), reply('second done')])
      await h.sendUser(t, 'first')
      await hold.started('m10')
      check(!(await read(h, t)).live.queuedUserInput, 'the message that started the run is not queued')
      await h.sendUser(t, 'second')
      check((await read(h, t)).live.queuedUserInput, 'a message sent during a run must show as queued user input')
      hold.release('m10')
      await h.settle()
      check(!(await read(h, t)).live.queuedUserInput, 'queued user input must stop showing once it ran')
    }
  }
]
