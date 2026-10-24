import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { turnInput } from '../core/decisions'
import type { CallKey, GateFacts } from '../core/facts'
import type {
  CompactionRequest,
  CompactionVerdict,
  GateHandlers,
  LifecycleHandlers,
  ToolDefinition
} from '../ports/harness'
import { check, same } from './assert'
import {
  aborted,
  append,
  assistantTexts,
  callTool,
  echoTool,
  holds,
  key,
  latch,
  message,
  noticeTexts,
  read,
  reply,
  spawnBackground,
  status,
  step,
  toolBase,
  toolResults,
  transact
} from './fixtures'
import type { ContractCase } from './harness'

const passGate = (before: GateHandlers['before']): GateHandlers => ({ before, after: async () => undefined })
const lifecycle = (partial: Partial<LifecycleHandlers>): LifecycleHandlers => ({
  onOpen: async () => {},
  onCompacting: async () => ({ summary: 'summary' }),
  onCompacted: async () => {},
  onClose: async () => {},
  ...partial
})

export const inboundCases: readonly ContractCase[] = [
  // Catches a gate whose block or rewrite is ignored, a call key that differs between gate and tool, or an after() that
  // cannot tell a nested call, so a nested call's result is offloaded (H9, D31).
  {
    name: 'tools run under a stable call key; the gate blocks, rewrites and replaces',
    covers: ['tools.register', 'toolGate.register'],
    needs: [],
    async run(open) {
      const seen: string[] = []
      const echoArgs: JsonValue[] = []
      const nestedAfter: JsonValue[] = []
      let dangerRuns = 0
      const echo: ToolDefinition = {
        ...toolBase('echo'),
        async run(call) {
          seen.push(`tool:${call.key}`)
          echoArgs.push(call.args)
          return { text: JSON.stringify(call.args), isError: false }
        }
      }
      const danger: ToolDefinition = {
        ...toolBase('danger'),
        async run() {
          dangerRuns += 1
          return { text: 'ran', isError: false }
        }
      }
      const gate: GateHandlers = {
        async before(call) {
          seen.push(`before:${call.key}`)
          if (call.tool === 'danger') return { block: 'not allowed' }
          return call.tool === 'echo' ? { args: { text: 'rewritten' } } : {}
        },
        async after(call, result) {
          seen.push(`after:${call.key}`)
          nestedAfter.push(call.nested)
          return call.tool === 'echo' ? { ...result, text: `replaced ${result.text}` } : undefined
        }
      }
      const h = await open((p) => {
        p.tools.register(echo)
        p.tools.register(danger)
        p.toolGate.register(gate)
      })
      const t = await h.createThread()
      h.script(t, [
        {
          text: '',
          toolCalls: [
            { name: 'echo', args: { text: 'orig' } },
            { name: 'danger', args: {} }
          ]
        },
        reply('done')
      ])
      await h.sendUser(t, 'go')
      await h.settle()
      same(echoArgs, [{ text: 'rewritten' }], 'the tool must run with the arguments the gate rewrote')
      check(dangerRuns === 0, 'a blocked call must not run')
      const [echoResult, dangerResult] = toolResults(await read(h, t))
      check(
        echoResult?.text === 'replaced {"text":"rewritten"}' && !echoResult.isError,
        'after() must replace the result'
      )
      check(
        dangerResult?.isError === true && dangerResult.text.includes('not allowed'),
        'a blocked call must leave an error result naming the reason'
      )
      const echoKey = seen[0].slice('before:'.length)
      same(
        seen.filter((s) => s.endsWith(`:${echoKey}`)),
        [`before:${echoKey}`, `tool:${echoKey}`, `after:${echoKey}`],
        'the gate and the tool must see one call key'
      )
      same(nestedAfter, [false], "after() must get the call's nested flag, false for a call the model made")
    }
  },
  // Catches a gate that cannot tell its call's turn stopped (G-C1): an approval it waits for would hold the stop until
  // a person answers.
  {
    name: "the gate's call signal aborts when its turn stops",
    covers: ['toolGate.register', 'turns.stop'],
    needs: [],
    async run(open) {
      const entered = latch()
      let sawAbort = false
      const h = await open((p) => {
        p.tools.register(echoTool())
        p.toolGate.register(
          passGate(async (call) => {
            entered.release()
            await aborted(call.signal)
            sawAbort = call.signal.aborted
            return { block: 'stopped while waiting' }
          })
        )
      })
      const t = await h.createThread()
      h.script(t, [callTool('echo', { text: 'x' }), reply('never')])
      await h.sendUser(t, 'go')
      await entered.promise
      await h.withCall(t, (p) => p.turns.stop(t, 'user'))
      check(sawAbort, "the gate's call signal must abort when the call's turn stops")
      check((await read(h, t)).live.runEnd?.outcome === 'aborted', 'the stop must end the run the gate held')
    }
  },
  // Catches an adapter whose history keys and gate keys disagree, so approvals can never be matched to calls (B-G2).
  {
    name: "a tool call and its result read back under the gate's call key",
    covers: ['ledger.read', 'toolGate.register'],
    needs: [],
    async run(open) {
      const gated: CallKey[] = []
      const h = await open((p) => {
        p.tools.register(echoTool())
        p.toolGate.register(
          passGate(async (call) => {
            gated.push(call.key)
            return {}
          })
        )
      })
      const t = await h.createThread()
      h.script(t, [callTool('echo', { text: 'x' }), reply('done')])
      await h.sendUser(t, 'go')
      await h.settle()
      const facts = await read(h, t)
      const calls = facts.history.flatMap((e) => (e.kind === 'assistant' ? e.toolCalls : []))
      const results = toolResults(facts)
      same(
        [...calls.map((c) => c.callKey), ...results.map((r) => r.callKey)],
        [gated[0], gated[0]],
        'the call and its result must carry the call key the gate saw'
      )
    }
  },
  // Catches a gate blind to plan state or the round's window, breaking plan gating and the repeated-call stop (D8, D37).
  {
    name: "the gate sees plan state and the goal round's call window",
    covers: ['toolGate.register'],
    needs: [],
    async run(open) {
      const facts: GateFacts[] = []
      const h = await open((p) => {
        p.tools.register(echoTool())
        p.toolGate.register(
          passGate(async (_call, f) => {
            facts.push(f)
            return {}
          })
        )
      })
      const t = await h.createThread()
      await h.withCall(t, (p) =>
        p.ledger.transact(t, () =>
          step(
            [
              {
                type: 'append-record',
                thread: t,
                record: { type: 'plan', value: { active: true, at: 0 } },
                key: key('c20-plan')
              }
            ],
            null
          )
        )
      )
      h.script(t, [
        {
          text: '',
          toolCalls: [
            { name: 'echo', args: { n: 1 } },
            { name: 'echo', args: { n: 2 } }
          ]
        },
        reply('round done'),
        callTool('echo', { n: 3 }),
        reply('human done')
      ])
      const round = turnInput(
        {
          type: 'goal-round',
          round: { id: 'goal-round:g:r1:v1:a1', goalId: 'g', revision: 1, round: 1, kind: 'work' }
        },
        'Round 1'
      )
      await h.withCall(t, (p) => p.turns.start(t, round, key('c20-round')))
      await h.settle()
      await h.sendUser(t, 'human')
      await h.settle()
      check(
        facts[1]?.goalRound === true && facts[1].plan?.active === true,
        'the gate must see the goal round and the plan state'
      )
      same(
        facts[1]?.callWindow.map((c) => c.args),
        [{ n: 1 }, { n: 2 }],
        "a goal round's window must hold its calls up to and including this one"
      )
      check(facts[2]?.goalRound === false && facts[2].callWindow.length === 0, 'a human turn has no goal-round window')
    }
  },
  // Catches reopen work running before the disarm handler, so an armed goal resumes on its own (G-f, DP K9).
  {
    name: 'onOpen runs on reopen before any resumed work',
    covers: ['lifecycle.register', 'turns.stop'],
    needs: ['restart'],
    async run(open) {
      const hold = holds()
      const events: string[] = []
      const handlers = lifecycle({
        async onOpen(thread, { reopened }, ports) {
          events.push(`open:${reopened}`)
          if (!reopened) return
          await ports.ledger.transact(thread, (f) =>
            step(f.keysSeen.has(key('c21-disarm')) ? [] : [append(thread, 'disarmed', 'c21-disarm')], null)
          )
          await ports.turns.stop(thread, 'goal-pause')
        }
      })
      const h = await open((p) => {
        p.tools.register(hold.tool)
        p.lifecycle.register(handlers)
      })
      const t = await h.createThread()
      h.script(t, [callTool('hold', { id: 'c21' }), reply('after restart')])
      await h.sendUser(t, 'go')
      await hold.started('c21')
      await h.restart()
      await h.settle()
      same(events, ['open:false', 'open:true'], 'onOpen must run at creation and again on reopen')
      const facts = await read(h, t)
      check(noticeTexts(facts).includes('disarmed'), "onOpen's writes must land on the reopened conversation")
      check(hold.invocations('c21') === 1, 'a run stopped in onOpen must not resume its tool')
      check(
        !assistantTexts(facts).includes('after restart'),
        'a run stopped in onOpen must make no further model request'
      )
      check(facts.live.runEnd?.outcome === 'aborted', 'the run stopped in onOpen must end aborted')
    }
  },
  // Catches a stop in onOpen that enables scheduling (Durable's `abort()`), resuming other conversations before their own onOpen (H12).
  {
    name: "a stop in one conversation's onOpen resumes no other conversation before its own onOpen",
    covers: ['lifecycle.register', 'turns.stop'],
    needs: ['restart'],
    async run(open) {
      const hold = holds()
      const holdOf = new Map<ThreadId, string>()
      const callsAtOpen = new Map<ThreadId, number>()
      let stopped: ThreadId | undefined
      const handlers = lifecycle({
        async onOpen(thread, { reopened }, ports) {
          if (!reopened) return
          callsAtOpen.set(thread, hold.invocations(holdOf.get(thread)!))
          if (stopped !== undefined) return
          stopped = thread
          await ports.turns.stop(thread, 'goal-pause')
        }
      })
      const h = await open((p) => {
        p.tools.register(hold.tool)
        p.lifecycle.register(handlers)
      })
      const threads = [await h.createThread(), await h.createThread()]
      for (const [i, t] of threads.entries()) {
        holdOf.set(t, `c28-${i}`)
        h.script(t, [callTool('hold', { id: `c28-${i}` }), reply(`c28-${i} done`)])
        await h.sendUser(t, 'go')
      }
      await Promise.all(threads.map((t) => hold.started(holdOf.get(t)!)))
      await h.restart()
      const first = stopped!
      const other = threads.find((t) => t !== first)!
      check(
        callsAtOpen.get(other) === 1,
        "a conversation's interrupted run must not resume before its own onOpen, whatever another onOpen stopped"
      )
      for (const t of threads) hold.release(holdOf.get(t)!)
      await h.settle()
      check(
        hold.invocations(holdOf.get(first)!) === 1 && (await read(h, first)).live.runEnd?.outcome === 'aborted',
        'the run stopped in onOpen must end aborted without rerunning its tool'
      )
      check(
        (await read(h, other)).live.runEnd?.outcome === 'completed',
        'a run its onOpen left alone must resume and complete'
      )
    }
  },
  // Catches an adapter that compacts without asking the package, compacts after a decline (D33), or keys two
  // compactions alike, so the second would reuse the first's memoized summary (H12, I-d).
  {
    name: 'a compaction asks onCompacting first and compacts nothing on a decline',
    covers: ['lifecycle.register'],
    needs: [],
    async run(open) {
      const asked: CompactionRequest[] = []
      const compacted: ThreadId[] = []
      let verdict: CompactionVerdict = { decline: true, reason: 'contract decline' }
      const h = await open((p) =>
        p.lifecycle.register(
          lifecycle({
            async onCompacting(_thread, request) {
              asked.push(request)
              return verdict
            },
            async onCompacted(thread) {
              compacted.push(thread)
            }
          })
        )
      )
      const t = await h.createThread()
      h.script(t, [reply('first'), reply('second')])
      await h.sendUser(t, 'before')
      await h.settle()
      await h.compact(t)
      const compactions = async () => (await read(h, t)).history.filter((e) => e.kind === 'compaction').length
      check((await compactions()) === 0 && compacted.length === 0, 'a declined compaction must change nothing')
      verdict = { summary: 'what happened so far' }
      await h.compact(t)
      check((await compactions()) === 1, 'a compaction with a summary must add one compaction entry')
      same(compacted, [t], 'onCompacted must run once, after the compaction that happened')
      await h.sendUser(t, 'after')
      await h.settle()
      await h.compact(t)
      check(
        asked.length === 3 && asked.every((r) => r.key !== '' && r.reason === 'manual' && r.messages.length > 0),
        'onCompacting must get a key, the reason and the messages to summarize'
      )
      check(asked[2].key !== asked[1].key, 'compactions of different histories must have different keys')
    }
  },
  // Catches a close that skips a conversation, so its shutdown record is never written (S-f).
  {
    name: 'onClose runs for every open conversation',
    covers: ['lifecycle.register'],
    needs: [],
    async run(open) {
      const closed: ThreadId[] = []
      const h = await open((p) =>
        p.lifecycle.register(
          lifecycle({
            async onClose(thread) {
              closed.push(thread)
            }
          })
        )
      )
      const a = await h.createThread()
      const b = await h.createThread()
      await h.close()
      same([...closed].sort(), [a, b].sort(), 'onClose must run once for every open conversation')
    }
  },
  // Catches a filter that is registered but never consulted (design §6.2 H10).
  {
    name: 'the context filter is consulted before every model request',
    covers: ['contextFilter.register'],
    needs: ['context-filter'],
    async run(open) {
      const consulted: ThreadId[] = []
      const h = await open((p) => {
        p.tools.register(echoTool())
        p.contextFilter.register({
          omit: (thread) => {
            consulted.push(thread)
            return []
          }
        })
      })
      const t = await h.createThread()
      h.script(t, [callTool('echo', { text: 'x' }), reply('done')])
      await h.sendUser(t, 'go')
      await h.settle()
      same(consulted, [t, t], 'the filter must be consulted before each of the two model requests')
    }
  },
  // Catches a filter whose answer is ignored (Stage A review M7): what it omits must be gone from what the model sees.
  {
    name: 'entries the context filter omits are left out of the model context',
    covers: ['contextFilter.register', 'ledger.modelContext'],
    needs: ['context-filter'],
    async run(open) {
      const hidden = key('m7-hidden')
      const h = await open((p) =>
        p.contextFilter.register({
          omit: (_thread, facts) =>
            facts.history.flatMap((e) => (e.kind === 'marker' && e.key === hidden ? [e.id] : []))
        })
      )
      const t = await h.createThread()
      await transact(h, t, () =>
        step(
          [
            { type: 'append-quiet', thread: t, input: status('kept for the model'), key: key('m7-kept') },
            { type: 'append-quiet', thread: t, input: status('left out'), key: hidden }
          ],
          null
        )
      )
      const context = JSON.stringify(await h.withCall(t, (p) => p.ledger.modelContext(t)))
      check(context.includes('kept for the model'), 'the model context must keep what the filter does not omit')
      check(!context.includes('left out'), 'the model context must leave out what the filter omits')
    }
  },
  // Catches a meter that sees the wrong count or lineage (a child's cap applied to the root conversation), or whose
  // refusal does not end the run (D24, harness-limited row 8).
  {
    name: 'the request meter can refuse a request and end the run',
    covers: ['requestMeter.register'],
    needs: [],
    async run(open) {
      const asked: [ThreadId, number, 'root' | 'child'][] = []
      const h = await open((p) => {
        p.tools.register(echoTool())
        p.requestMeter.register({
          allow: (thread, requestsInRun, lineage) => {
            asked.push([thread, requestsInRun, lineage])
            return requestsInRun < 1 ? { ok: true } : { ok: false, text: 'request cap reached' }
          }
        })
      })
      const t = await h.createThread()
      h.script(t, [callTool('echo', { text: 'x' }), reply('never')])
      await h.sendUser(t, 'go')
      await h.settle()
      same(
        asked,
        [
          [t, 0, 'root'],
          [t, 1, 'root']
        ],
        'the meter must see each request with the count before it and the root lineage'
      )
      const facts = await read(h, t)
      const last = facts.history.at(-1)
      check(
        last?.kind === 'assistant' && last.stop === 'error' && last.error?.includes('request cap reached') === true,
        'a refused request must end the run with the refusal text'
      )
      check(
        !assistantTexts(facts).includes('never') && facts.live.runEnd?.outcome === 'error',
        'a refused request must fail the run'
      )
      const child = await spawnBackground(h, t, 'c31')
      h.script(child, [reply('child done')])
      await h.withCall(t, (p) => p.helpers.message(child, message('go'), key('c31-msg')))
      await h.withCall(t, (p) => p.helpers.awaitAnswer(child, 1, key('c31-msg')))
      same(asked.slice(2), [[child, 0, 'child']], "a spawned conversation's requests must be metered as a child's")
    }
  }
]
