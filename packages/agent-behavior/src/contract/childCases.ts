import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { ToolDefinition } from '../ports/harness'
import { check, same } from './assert'
import {
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
  toolBase
} from './fixtures'
import type { ContractCase } from './harness'

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
  // Catches a repeated message key starting a second run, or a message to a running child starting a new one (DP S8).
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
      same(await send('c12-second'), { run: 1, status: 'queued' }, 'a message to a running child must join its run')
      hold.release('c12')
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
