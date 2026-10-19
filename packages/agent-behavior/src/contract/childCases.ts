import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import type { ChildSpec } from '../core/decisions'
import type { ConversationFacts, HistoryEntry, UsageFact } from '../core/facts'
import { FORK_PLACEHOLDER_RESULT, INTERRUPTED_CALL_RESULT } from '../core/subagents/subagentText'
import type { MessageResult, ToolDefinition } from '../ports/harness'
import { check, same } from './assert'
import {
  append,
  assistantTexts,
  callTool,
  childSpec,
  echoTool,
  holds,
  key,
  latch,
  markersWith,
  message,
  read,
  reply,
  spawnBackground,
  step,
  toolBase,
  toolResults,
  transact
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
/** A background child of the transacting thread forked from `from` at `at`. */
const forkSpec = (label: string, from: ThreadId, at: ItemId): ChildSpec => {
  const base = childSpec('background', label)
  return {
    ...base,
    fork: { from, at },
    origin: { ...base.origin, fork: true },
    record: { ...base.record, fork: true }
  }
}
/** Each call of the last assistant entry that calls `tool`, with the text of the result that answers it after it. */
function answersTo(facts: ConversationFacts, tool: string): { readonly answered: string | undefined }[] {
  const at = facts.history.findLastIndex((e) => e.kind === 'assistant' && e.toolCalls.some((c) => c.name === tool))
  const reply: HistoryEntry | undefined = facts.history[at]
  if (reply?.kind !== 'assistant') return []
  const later = toolResults({ ...facts, history: facts.history.slice(at + 1) })
  return reply.toolCalls.map((call) => ({ answered: later.find((result) => result.callId === call.callId)?.text }))
}

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
  // Catches a steer carried into the next run when the run it joined ends before a boundary takes it (G-C5): the next
  // run would start with input nobody sent it, which on a parent's tool call is a run the parent never recorded.
  {
    name: 'a steer whose run ends before a boundary takes it is withdrawn, not carried into the next run',
    covers: ['helpers.message', 'helpers.stop', 'helpers.awaitAnswer', 'ledger.read'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c36')
      h.script(child, [callTool('hold', { id: 'c36' }), reply('next')])
      const send = (label: string, run?: number) =>
        h.withCall(t, (p) => p.helpers.message(child, message(label), key(label), run))
      same(await send('c36-go'), { run: 1, status: 'started' }, 'an idle child must start run 1')
      await hold.started('c36')
      const steer = send('c36-steer', 1)
      await h.withCall(t, (p) => p.helpers.stop(child, 1))
      same(await send('c36-again'), { run: 2, status: 'started' }, 'a message after the run ended must start run 2')
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 2, key('c36-again')))
      // Awaited only now, so a harness that carries the steer into run 2 answers it there and fails here.
      same(await steer, { run: 1, status: 'withdrawn' }, 'a steer its run ended without taking must be withdrawn')
      check(markersWith(await read(h, child), key('c36-steer')).length === 0, 'the steer must not reach run 2')
      check((await read(h, t)).children.get(child)?.runUsage.length === 2, 'the steer must start no run of its own')
    }
  },
  // Catches a steer that keeps its tool call waiting for the child's next boundary after the caller's turn stopped
  // (H3): a run ends only once its calls return, so the stop would wait on the child, or on an approval it waits for.
  {
    name: 'stopping a turn withdraws the steer one of its tool calls waits on, without waiting for the child',
    covers: ['helpers.message', 'turns.stop', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const steering = latch()
      const sent: { child?: ThreadId; answer?: MessageResult } = {}
      const steerer: ToolDefinition = {
        ...toolBase('steerer'),
        async run(_call, ports) {
          const answer = ports.helpers.message(sent.child!, message('steer'), key('c35-steer'), 1)
          steering.release()
          sent.answer = await answer
          return { text: sent.answer.status, isError: false }
        }
      }
      const h = await open((p) => {
        p.tools.register(hold.tool)
        p.tools.register(steerer)
      })
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c35')
      sent.child = child
      h.script(child, [callTool('hold', { id: 'c35' }), reply('child done')])
      await h.withCall(t, (p) => p.helpers.message(child, message('work'), key('c35-msg')))
      await hold.started('c35')
      h.script(t, [callTool('steerer', {}), reply('never')])
      await h.sendUser(t, 'go')
      await steering.promise
      await h.withCall(t, (p) => p.turns.stop(t, 'user'))
      same(sent.answer, { run: 1, status: 'withdrawn' }, 'stopping the turn must withdraw the steer its call waits on')
      check((await read(h, t)).children.get(child)?.running === true, 'the stop must return while the child still runs')
      hold.release('c35')
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c35-msg')))
      check(markersWith(await read(h, child), key('c35-steer')).length === 0, 'a withdrawn steer must add no input')
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
  // Catches a fork whose copy of the fork point keeps that entry's calls without results (I4): the child's first model
  // request would carry tool calls no result answers, which providers reject or each SDK patches differently.
  {
    name: 'a fork answers each call of its fork point with the placeholder result',
    covers: ['ledger.transact', 'ledger.read', 'tools.register'],
    needs: [],
    async run(open) {
      const forked: { child?: ThreadId } = {}
      const forker: ToolDefinition = {
        ...toolBase('forker'),
        async run(call, ports) {
          const at = (await ports.ledger.read(call.thread)).history.findLast((e) => e.kind === 'assistant')!.id
          const { spawned } = await ports.ledger.transact(call.thread, () =>
            step([{ type: 'spawn-child', spec: forkSpec('c37', call.thread, at), key: key('c37') }], null)
          )
          forked.child = spawned[0].child
          return { text: 'forked', isError: false }
        }
      }
      const h = await open((p) => {
        p.tools.register(forker)
        p.tools.register(echoTool())
      })
      const t = await h.createThread()
      h.script(t, [
        {
          text: '',
          toolCalls: [
            { name: 'echo', args: {} },
            { name: 'forker', args: {} }
          ]
        },
        reply('done')
      ])
      await h.sendUser(t, 'go')
      await h.settle()
      const child = forked.child!
      same(
        answersTo(await read(h, child), 'forker'),
        [{ answered: FORK_PLACEHOLDER_RESULT }, { answered: FORK_PLACEHOLDER_RESULT }],
        'a fork must answer every call of its fork point with the placeholder, the ones that ran in the parent too'
      )
      check(
        toolResults(await read(h, child)).every((result) => !result.isError),
        'a placeholder result must not be an error'
      )
    }
  },
  // Catches a run started on a child whose last reply has calls without results (I4, H3): the run's first model
  // request would carry those calls unanswered.
  {
    name: 'a message that starts a child run first answers the calls its last reply left open',
    covers: ['helpers.message', 'helpers.awaitAnswer', 'ledger.read'],
    needs: [],
    async run(open) {
      const forked: { child?: ThreadId } = {}
      const forker: ToolDefinition = {
        ...toolBase('forker'),
        async run(call, ports) {
          // Forking at a record after this reply leaves the reply's call without a result in the child.
          await ports.ledger.transact(call.thread, () => step([append(call.thread, 'forking', 'c38-notice')], null))
          const at = (await ports.ledger.read(call.thread)).history.at(-1)!.id
          const { spawned } = await ports.ledger.transact(call.thread, () =>
            step([{ type: 'spawn-child', spec: forkSpec('c38', call.thread, at), key: key('c38') }], null)
          )
          forked.child = spawned[0].child
          return { text: 'forked', isError: false }
        }
      }
      const h = await open((p) => p.tools.register(forker))
      const t = await h.createThread()
      h.script(t, [callTool('forker', {}), reply('done')])
      await h.sendUser(t, 'go')
      await h.settle()
      const child = forked.child!
      h.script(child, [reply('child answer')])
      await h.withCall(t, (p) => p.helpers.message(child, message('go'), key('c38-msg')))
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c38-msg')))
      const facts = await read(h, child)
      same(
        answersTo(facts, 'forker'),
        [{ answered: INTERRUPTED_CALL_RESULT }],
        'a message that starts a run must first answer the open calls of the last reply'
      )
      const answer = facts.history.findIndex((e) => e.kind === 'tool-result' && e.text === INTERRUPTED_CALL_RESULT)
      const input = facts.history.findIndex((e) => e.kind === 'marker' && e.key === key('c38-msg'))
      const result = facts.history[answer]
      check(
        result?.kind === 'tool-result' && result.isError && answer < input,
        'the interrupted result must be an error that precedes the run input'
      )
    }
  },
  // Catches an S-j fork answered with the fork placeholder (N1): the calls open in the conversation it forks ended with
  // that conversation's run, so the model would be told they still run and wait for results that never come.
  {
    name: 'an S-j fork answers the calls open at its fork point as interrupted, not as still running',
    covers: ['ledger.transact', 'helpers.message', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const source = await spawnBackground(h, t, 'c39-source')
      h.script(source, [callTool('hold', { id: 'c39' }), reply('source done')])
      await h.withCall(t, (p) => p.helpers.message(source, message('work'), key('c39-work')))
      await hold.started('c39')
      // The source ends in the reply whose call is still open, the shape S-j forks after a cut run.
      const at = (await read(h, source)).history.findLast((e) => e.kind === 'assistant')!.id
      const { spawned } = await transact(h, t, () =>
        step([{ type: 'spawn-child', spec: forkSpec('c39', source, at), key: key('c39') }], null)
      )
      const fork = spawned[0].child
      hold.release('c39')
      await h.withCall(t, (p) => p.helpers.awaitAnswer(source, 1, key('c39-work')))
      h.script(fork, [reply('fork answer')])
      await h.withCall(t, (p) => p.helpers.message(fork, message('go on'), key('c39-msg')))
      await h.withCall(t, (p) => p.helpers.awaitAnswer(fork, 1, key('c39-msg')))
      same(
        answersTo(await read(h, fork), 'hold'),
        [{ answered: INTERRUPTED_CALL_RESULT }],
        'an S-j fork must answer the calls open at its fork point as interrupted'
      )
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
