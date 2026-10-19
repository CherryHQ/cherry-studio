import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { UsageFact } from '../core/facts'
import type { LifecycleHandlers } from '../ports/harness'
import { check, rejects, same } from './assert'
import {
  append,
  callTool,
  childSpec,
  holds,
  key,
  latch,
  markersWith,
  message,
  noticeTexts,
  read,
  reply,
  runRecordOf,
  spawnBackground,
  status,
  step,
  transact
} from './fixtures'
import type { ContractCase } from './harness'

const U1: UsageFact = { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, totalTokens: 16, costUsd: 0.25 }
const U2: UsageFact = { input: 20, output: 7, cacheRead: 2, cacheWrite: 1, totalTokens: 30, costUsd: 0.5 }
const noLifecycle = (onCompacted: LifecycleHandlers['onCompacted']): LifecycleHandlers => ({
  onOpen: async () => {},
  onCompacted,
  onClose: async () => {}
})

export const ledgerCases: readonly ContractCase[] = [
  // Catches a partial commit: a failing decide or operation leaving some writes behind (design §6.1 H1).
  {
    name: 'transact writes nothing when decide or an operation throws',
    covers: ['ledger.transact', 'ledger.read'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      const before = await read(h, t)
      const thrown = await rejects(
        () =>
          transact(h, t, () => {
            throw new Error('decide failed')
          }),
        'a throwing decide must reject'
      )
      check(thrown.message === 'decide failed', 'transact must reject with the error decide threw')
      await rejects(
        () =>
          transact(h, t, () =>
            step([append(t, 'kept?', 'c1-a'), append('contract-missing' as ThreadId, 'lost', 'c1-b')], null)
          ),
        'an operation on an unknown thread must reject the transaction'
      )
      const after = await read(h, t)
      same(after.history, before.history, 'a rejected transaction must leave history unchanged')
      check(!after.keysSeen.has(key('c1-a')), 'a rejected transaction must leave no key behind')
    }
  },
  // Catches a lost update when two calls read the same facts and both write (DP K1).
  {
    name: 'transact reads and writes atomically under concurrency',
    covers: ['ledger.transact'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      const bump = () =>
        transact(h, t, (f) => {
          const n = noticeTexts(f).length + 1
          return step([append(t, String(n), `c2-${n}`)], n)
        })
      const results = await Promise.all([bump(), bump(), bump()])
      same(results.map((r) => r.result).sort(), [1, 2, 3], 'each transaction must see the writes committed before it')
      same(noticeTexts(await read(h, t)), ['1', '2', '3'], 'concurrent transactions must not lose a write')
    }
  },
  // Catches applied keys missing from keysSeen, so every rerun repeats its writes (design §7.2).
  {
    name: 'applied operation keys are visible in keysSeen',
    covers: ['ledger.transact', 'ledger.read', 'jobs.register'],
    needs: [],
    async run(open) {
      const done = latch()
      const h = await open((p) =>
        p.jobs.register('subagent-report', async () => {
          await done.promise
        })
      )
      const t = await h.createThread()
      const { spawned } = await transact(h, t, () =>
        step(
          [
            append(t, 'record', 'c3-record'),
            { type: 'append-quiet', thread: t, input: status('quiet'), key: key('c3-quiet') },
            { type: 'spawn-child', spec: childSpec('background', 'c3'), key: key('c3-spawn') },
            {
              type: 'ensure-job',
              job: { kind: 'subagent-report', scope: t, input: null, onRestart: 'resume' },
              key: key('c3-job')
            }
          ],
          null
        )
      )
      check(
        spawned.length === 1 && spawned[0].key === key('c3-spawn'),
        'transact must report the spawned child under its op key'
      )
      const child = spawned[0].child
      const facts = await read(h, t)
      for (const label of ['c3-record', 'c3-quiet', 'c3-spawn', 'c3-job'])
        check(facts.keysSeen.has(key(label)), `keysSeen must contain ${label}`)
      check(
        markersWith(facts, key('c3-quiet')).length === 1,
        'a quiet input must enter history as a marker with its key'
      )
      check(runRecordOf(facts, key('c3-spawn'))?.sessionId === child, "the parent's run record must name the new child")
      check(facts.children.has(child), 'children must list the spawned child')
      const childFacts = await read(h, child)
      same(
        childFacts.lineage,
        { kind: 'subagent', parent: t, origin: childSpec('background', 'c3').origin },
        'the child must know its parent and origin'
      )
      check(
        childFacts.history.some(
          (e) => e.kind === 'record' && e.record.type === 'subagent-origin' && e.key === key('c3-spawn')
        ),
        'the child must hold its origin record under the spawn key'
      )
      done.release()
      await h.settle()
      check(!(await read(h, t)).keysSeen.has(key('c3-job')), 'a finished job must leave keysSeen')
    }
  },
  // Catches records leaking into the model context, or quiet inputs never reaching it (design §4.1 E4).
  {
    name: 'records stay out of the model context; quiet inputs enter it',
    covers: ['ledger.modelContext', 'ledger.transact'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      const size = () => h.withCall(t, async (p) => (await p.ledger.modelContext(t)).length)
      const start = await size()
      await transact(h, t, () => step([append(t, 'display only', 'c4-record')], null))
      check((await size()) === start, 'a record must not change what the model sees')
      await transact(h, t, () =>
        step([{ type: 'append-quiet', thread: t, input: status('seen'), key: key('c4-quiet') }], null)
      )
      check((await size()) > start, 'a quiet input must reach the model context')
    }
  },
  // Catches a quiet input written into a busy conversation, which only the Harness may do (harness-limited row 7).
  {
    name: 'quiet inputs are refused while a run is active',
    covers: ['ledger.transact', 'tools.register'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'c5' }), reply('done')])
      await h.sendUser(t, 'go')
      await hold.started('c5')
      const before = (await read(h, t)).history.length
      await rejects(
        () =>
          transact(h, t, () =>
            step([{ type: 'append-quiet', thread: t, input: status('late'), key: key('c5-quiet') }], null)
          ),
        'append-quiet must be refused while a run is active'
      )
      check((await read(h, t)).history.length === before, 'a refused quiet input must write nothing')
      hold.release('c5')
      await h.settle()
    }
  },
  // Catches history that drops entries folded by compaction, breaking recall and goal accounting (design §4.3), or user
  // entries projected without their text, which recall cannot search (B-G1).
  {
    name: 'history keeps full lineage across compaction',
    covers: ['ledger.read', 'lifecycle.register'],
    needs: [],
    async run(open) {
      const compacted: ThreadId[] = []
      const h = await open((p) =>
        p.lifecycle.register(
          noLifecycle(async (thread) => {
            compacted.push(thread)
          })
        )
      )
      const t = await h.createThread()
      h.script(t, [reply('first'), reply('second')])
      await h.sendUser(t, 'before')
      await h.settle()
      await h.compact(t)
      await h.sendUser(t, 'after')
      await h.settle()
      const history = (await read(h, t)).history
      const kinds = history.map((e) => e.kind)
      check(kinds.filter((k) => k === 'user').length === 2, 'entries before the compaction must stay readable')
      same(
        history.flatMap((e) => (e.kind === 'user' ? [e.text] : [])),
        ['before', 'after'],
        'a user entry must read back with the text that was sent'
      )
      check(
        kinds.indexOf('user') < kinds.indexOf('compaction') && kinds.indexOf('compaction') < kinds.lastIndexOf('user'),
        'history must keep the compaction in order'
      )
      same(compacted, [t], 'onCompacted must run once for the compacted thread')
    }
  },
  // Catches child usage taken from tool results or a stale running flag, which double-bills or mis-counts slots (R3, S-e),
  // or a stale or wrong lastItem, which would fork a continuation from the wrong point (S-j).
  {
    name: 'children report running and per-run usage from their own entries',
    covers: ['ledger.read', 'helpers.message', 'helpers.awaitAnswer'],
    needs: [],
    async run(open) {
      const hold = holds()
      const h = await open((p) => p.tools.register(hold.tool))
      const t = await h.createThread()
      const child = await spawnBackground(h, t, 'c7')
      h.script(child, [callTool('hold', { id: 'c7' }, U1), reply('done', U2)])
      await h.withCall(t, (p) => p.helpers.message(child, message('work'), key('c7-msg')))
      await hold.started('c7')
      check((await read(h, t)).children.get(child)?.running === true, 'a child with an active run must report running')
      hold.release('c7')
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c7-msg')))
      const facts = (await read(h, t)).children.get(child)
      check(facts?.running === false, 'a child whose run ended must not report running')
      same(
        facts?.runUsage,
        [{ input: 30, output: 12, cacheRead: 3, cacheWrite: 1, totalTokens: 46, costUsd: 0.75 }],
        "run usage must sum the child's own entries"
      )
      check(
        facts?.lastItem === (await read(h, child)).history.at(-1)?.id,
        "lastItem must be the id of the child's last history entry once its run ended"
      )
    }
  }
]
