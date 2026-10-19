import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { UsageFact } from '../core/facts'
import type { ToolDefinition } from '../ports/harness'
import { check, same } from './assert'
import {
  assistantTexts,
  callTool,
  childSpec,
  holds,
  key,
  markersWith,
  message,
  read,
  reply,
  spawnBackground,
  step,
  toolBase,
  toolResults
} from './fixtures'
import type { ContractCase } from './harness'

const usage = (input: number, output: number, costUsd: number): UsageFact => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  costUsd
})

export const childCases: readonly ContractCase[] = [
  // Catches a parent stop that misses its foreground child or kills a background one (owner decision Q1).
  {
    name: 'foreground children stop with the parent turn; background children do not',
    covers: ['turns.stop', 'ledger.transact', 'helpers.message', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const children: { fg?: ThreadId; bg?: ThreadId } = {}
      const spawner: ToolDefinition = {
        ...toolBase('spawner'),
        async run(call, ports) {
          const { spawned } = await ports.ledger.transact(call.thread, () =>
            step(
              [
                { type: 'spawn-child', spec: childSpec('foreground', 'c11-fg'), key: key('c11-fg') },
                { type: 'spawn-child', spec: childSpec('background', 'c11-bg'), key: key('c11-bg') }
              ],
              null
            )
          )
          const fg = spawned.find((s) => s.key === key('c11-fg'))!.child
          const bg = spawned.find((s) => s.key === key('c11-bg'))!.child
          Object.assign(children, { fg, bg })
          h.script(fg, [callTool('hold', { id: 'c11-fg' }), reply('fg done')])
          h.script(bg, [callTool('hold', { id: 'c11-bg' }), reply('bg done')])
          await ports.helpers.message(fg, message('fg'), key('c11-fg-msg'))
          await ports.helpers.message(bg, message('bg'), key('c11-bg-msg'))
          const answer = await ports.helpers.awaitAnswer(fg, 1, key('c11-fg-msg'))
          return { text: answer.text, isError: false }
        }
      }
      const h = await open((p) => {
        p.tools.register(hold.tool)
        p.tools.register(spawner)
      })
      const t = await h.createThread()
      h.script(t, [callTool('spawner', {}), reply('parent done')])
      await h.sendUser(t, 'go')
      await Promise.all([hold.started('c11-fg'), hold.started('c11-bg')])
      await h.withCall(t, (p) => p.turns.stop(t, 'user'))
      const fgEnd = await h.withCall(t, (p) => p.helpers.awaitAnswer(children.fg!, 1, key('c11-fg-msg')))
      check(fgEnd.outcome === 'aborted', 'stopping the parent turn must stop its foreground child')
      check(
        (await read(h, t)).children.get(children.bg!)?.running === true,
        'stopping the parent turn must not stop a background child'
      )
      hold.release('c11-bg')
      const bgEnd = await h.withCall(t, (p) => p.helpers.awaitAnswer(children.bg!, 1, key('c11-bg-msg')))
      same(bgEnd, { outcome: 'completed', text: 'bg done' }, 'the background child must finish its run')
    }
  },
  // Catches a repeated message key adding input or a run, also after its run ended (the report job's rerun), or a message to a running child starting a new one (DP S8).
  {
    name: 'message starts a child run once per key and joins a running run',
    covers: ['helpers.message', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c12')
      h.script(child, [callTool('hold', { id: 'c12' }), reply('answer')])
      const send = (label: string) => h.withCall(t, (p) => p.helpers.message(child, message(label), key(label)))
      same(await send('c12-first'), { run: 1, status: 'started' }, 'an idle child must start a run')
      same(await send('c12-first'), { run: 1, status: 'started' }, 'the same key must return the original admission')
      await hold.started('c12')
      const second = send('c12-second')
      hold.release('c12')
      same(await second, { run: 1, status: 'queued' }, 'a message to a running child must join its run')
      same(
        await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c12-first'))),
        { outcome: 'completed', text: 'answer' },
        'awaitAnswer must report how the run ended'
      )
      const facts = await read(h, child)
      check(
        markersWith(facts, key('c12-first')).length === 1 && markersWith(facts, key('c12-second')).length === 1,
        'each message key must add exactly one input'
      )
      same(await send('c12-first'), { run: 1, status: 'started' }, 'a key whose run ended must return its first result')
      await h.settle()
      const inputs = (await read(h, child)).history.filter((e) => e.kind === 'marker').length
      check(
        inputs === 2 && (await read(h, t)).children.get(child)?.runUsage.length === 1,
        'a key whose run ended must add no input and start no run'
      )
    }
  },
  // Catches a steer that starts a run nobody recorded when its run had already ended (G-C5): the parent never learns of
  // that run, and its output is never delivered.
  {
    name: 'a steer for a run that has ended is withdrawn and starts no run',
    covers: ['helpers.message', 'helpers.awaitAnswer', 'ledger.read'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c34')
      h.script(child, [reply('done'), reply('never')])
      const first = await h.withCall(t, (p) => p.helpers.message(child, message('go'), key('c34-go')))
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, first.run, key('c34-go')))
      const steer = () => h.withCall(t, (p) => p.helpers.message(child, message('late'), key('c34-steer'), first.run))
      same(await steer(), { run: first.run, status: 'withdrawn' }, 'a steer for an ended run must be withdrawn')
      same(await steer(), { run: first.run, status: 'withdrawn' }, 'the same key must return the original answer')
      await h.settle()
      check(markersWith(await read(h, child), key('c34-steer')).length === 0, 'a withdrawn steer must add no input')
      check((await read(h, t)).children.get(child)?.runUsage.length === 1, 'a withdrawn steer must start no run')
    }
  },
  // Catches a child stop that ignores its run number, resolves before that run has ended, or reports it as completed.
  {
    name: 'stopping a child ends its run as aborted',
    covers: ['helpers.stop', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c13')
      h.script(child, [callTool('hold', { id: 'c13' }), reply('never')])
      const { run } = await h.withCall(t, (p) => p.helpers.message(child, message('work'), key('c13-msg')))
      await hold.started('c13')
      await h.withCall(t, (p) => p.helpers.stop(child, run + 1))
      check((await read(h, t)).children.get(child)?.running === true, 'stop with a stale run must do nothing')
      await h.withCall(t, (p) => p.helpers.stop(child, run))
      check(
        (await read(h, t)).children.get(child)?.running === false,
        'stop must resolve once the stopped run has ended'
      )
      const end = await h.withCall(t, (p) => p.helpers.awaitAnswer(child, run, key('c13-msg')))
      check(end.outcome === 'aborted', 'a stopped child run must end aborted')
    }
  },
  // Catches a continuation numbered or billed as the first run, or a stale stop ending the next run (design §7.5, I4).
  {
    name: 'a message after a run ended starts the next run, and run usage keeps the runs apart',
    covers: ['helpers.message', 'helpers.awaitAnswer', 'helpers.stop', 'ledger.read'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c26')
      const [first, held, second] = [usage(10, 5, 0.25), usage(20, 7, 0.5), usage(3, 2, 0.125)]
      h.script(child, [reply('one', first), callTool('hold', { id: 'c26' }, held), reply('two', second)])
      const send = (label: string) => h.withCall(t, (p) => p.helpers.message(child, message(label), key(label)))
      const answer = (run: number, label: string) => h.withCall(t, (p) => p.helpers.awaitAnswer(child, run, key(label)))
      same(await send('c26-1'), { run: 1, status: 'started' }, 'an idle child must start run 1')
      same(await answer(1, 'c26-1'), { outcome: 'completed', text: 'one' }, 'run 1 must answer the first message')
      same(await send('c26-2'), { run: 2, status: 'started' }, 'a message after run 1 ended must start run 2')
      await hold.started('c26')
      await h.withCall(t, (p) => p.helpers.stop(child, 1))
      check((await read(h, t)).children.get(child)?.running === true, 'stopping an ended run must not stop run 2')
      hold.release('c26')
      same(await answer(2, 'c26-2'), { outcome: 'completed', text: 'two' }, 'run 2 must answer the second message')
      same(
        (await read(h, t)).children.get(child)?.runUsage,
        [first, usage(23, 9, 0.625)],
        'run usage must sum each run on its own'
      )
    }
  },
  // Catches a run usage list whose length drifts from the runs started (none before the first run, an active or aborted
  // run left out), so `isLive` and budget accounting misread which runs exist (R3, S-e).
  {
    name: 'run usage has one entry per run the child started, active and aborted runs included',
    covers: ['ledger.read', 'helpers.message', 'helpers.stop', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c32')
      const runs = async () => (await read(h, t)).children.get(child)?.runUsage.length
      check((await runs()) === 0, 'a child that started no run must have no run usage entry')
      h.script(child, [
        callTool('hold', { id: 'c32-1' }, usage(10, 5, 0.25)),
        callTool('hold', { id: 'c32-2' }, usage(20, 7, 0.5)),
        reply('two', usage(3, 2, 0.125))
      ])
      const send = (label: string) => h.withCall(t, (p) => p.helpers.message(child, message(label), key(label)))
      same(await send('c32-1'), { run: 1, status: 'started' }, 'an idle child must start run 1')
      await hold.started('c32-1')
      check((await runs()) === 1, 'an active run must have its run usage entry')
      await h.withCall(t, (p) => p.helpers.stop(child, 1))
      const end = await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c32-1')))
      check(end.outcome === 'aborted' && (await runs()) === 1, 'an aborted run must keep its run usage entry')
      same(await send('c32-2'), { run: 2, status: 'started' }, 'a message after run 1 ended must start run 2')
      await hold.started('c32-2')
      check((await runs()) === 2, 'the next active run must add exactly one run usage entry')
      hold.release('c32-2')
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 2, key('c32-2')))
      check((await runs()) === 2, 'two runs started must leave exactly two run usage entries')
    }
  },
  // Catches a fork that counts the inherited history as runs of its own, which charges the parent's usage to the child
  // and shifts its run numbers (S-j, R3).
  {
    name: 'a forked child counts no inherited entry as its own run or usage',
    covers: ['ledger.transact', 'ledger.read', 'helpers.message', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      h.script(t, [reply('parent answer', usage(100, 50, 2))])
      await h.sendUser(t, 'go')
      await h.settle()
      const at = (await read(h, t)).history.at(-1)!.id
      const base = childSpec('background', 'c33')
      const { spawned } = await h.withCall(t, (p) =>
        p.ledger.transact(t, () =>
          step(
            [
              {
                type: 'spawn-child',
                spec: {
                  ...base,
                  fork: { from: t, at },
                  origin: { ...base.origin, fork: true },
                  record: { ...base.record, fork: true }
                },
                key: key('c33')
              }
            ],
            null
          )
        )
      )
      const child = spawned[0].child
      check(
        assistantTexts(await read(h, child)).includes('parent answer'),
        "a fork must carry the parent's history up to the fork point"
      )
      same((await read(h, t)).children.get(child)?.runUsage, [], 'a fork must start with no run of its own')
      const own = usage(3, 2, 0.125)
      h.script(child, [reply('child answer', own)])
      same(
        await h.withCall(t, (p) => p.helpers.message(child, message('go'), key('c33-msg'))),
        { run: 1, status: 'started' },
        "a fork's first message must start its run 1"
      )
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c33-msg')))
      same((await read(h, t)).children.get(child)?.runUsage, [own], "a fork's run usage must sum only its own entries")
    }
  },
  // Catches an adapter that builds a child's tools by name or not at all, so a 'parent-only' tool runs in the child.
  {
    name: 'a parent-only tool runs for the parent and is absent from a spawned child',
    covers: ['tools.register', 'ledger.transact'],
    needs: [],
    async run(open) {
      const callers: ThreadId[] = []
      const parentOnly: ToolDefinition = {
        ...toolBase('parent_only'),
        availability: 'parent-only',
        async run(call) {
          callers.push(call.thread)
          return { text: 'ran', isError: false }
        }
      }
      const h = await open((p) => p.tools.register(parentOnly))
      const t = await h.createThread()
      h.script(t, [callTool('parent_only', {}), reply('parent done')])
      await h.sendUser(t, 'go')
      await h.settle()
      const child = await spawnBackground(h, t, 'c30')
      h.script(child, [callTool('parent_only', {}), reply('child done')])
      await h.withCall(t, (p) => p.helpers.message(child, message('go'), key('c30-msg')))
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c30-msg')))
      same(callers, [t], 'a parent-only tool must run for the parent and never in a child')
      check(
        toolResults(await read(h, child))[0]?.isError === true,
        'a child calling a parent-only tool must get an error result'
      )
    }
  },
  // Catches a wait lost on restart, which strands the report job forever (design §7.4).
  {
    name: 'awaitAnswer is re-established after a restart',
    covers: ['helpers.awaitAnswer'],
    needs: ['restart'],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c14')
      h.script(child, [callTool('hold', { id: 'c14' }), reply('answer')])
      await h.withCall(t, (p) => p.helpers.message(child, message('work'), key('c14-msg')))
      await hold.started('c14')
      await h.restart()
      const answer = h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c14-msg')))
      hold.release('c14')
      same(await answer, { outcome: 'completed', text: 'answer' }, 'the same key must reach the run after a restart')
    }
  }
]
