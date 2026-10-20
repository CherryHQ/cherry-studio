import { join } from 'node:path'

import type { TSchema } from '@earendil-works/pi-ai'
import { type ExtensionAPI, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  type ChildSpec,
  type ConversationFacts,
  encodeEntry,
  type Key,
  type MessageResult,
  type ToolDefinition,
  type TurnInput
} from '@cherrystudio/agent-behavior'
import { type ItemId, runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeEvent, BehaviorSessionRequest, CompactionSummarizer } from '../src'
import { type OpenSession, openPiHarness, type PiHarness } from './behaviorHarness'

const read = (pi: PiHarness, thread: ThreadId): Promise<ConversationFacts> =>
  pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))

function latch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const aborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })

const key = (label: string) => `test:${label}` as Key
const input = (text: string): TurnInput => ({ ...encodeEntry({ type: 'subagent-message' }), text })
const spec: ChildSpec = {
  boundary: 'background',
  origin: { parentToolCallId: 'call', fork: false, description: 'child', modelKey: 'contract/model' },
  record: {
    parentToolCallId: 'call',
    description: 'child',
    fork: false,
    background: true,
    modelKey: 'contract/model',
    run: 1,
    status: 'running'
  }
}
const noLifecycle = {
  onOpen: async () => {},
  onCompacting: async () => ({ summary: 'summary' }),
  onCompacted: async () => {},
  onClose: async () => {}
}
const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  schema: { type: 'object' },
  replay: 'safe',
  executionMode: 'sequential',
  availability: 'all',
  modelOnly: true,
  run: async () => ({ text: name, isError: false })
})
/** A tool whose call waits until released or aborted. */
function holdTool(name = 'hold') {
  const started = latch()
  const gate = latch()
  const definition: ToolDefinition = {
    ...tool(name),
    run: async (call) => {
      started.release()
      await Promise.race([gate.promise, aborted(call.signal)])
      return { text: 'held', isError: false }
    }
  }
  return { tool: definition, started: started.promise, release: gate.release }
}
const markerKeys = (facts: ConversationFacts) =>
  facts.history.flatMap((entry) => (entry.kind === 'marker' ? [entry.key] : []))
/** Sessions that compact on their own after a reply: the threshold sits one token above an empty context. */
const autoCompacting =
  (onEvent?: (event: AgentRuntimeEvent) => void) => (request: BehaviorSessionRequest, open: OpenSession) =>
    open(request, {
      compaction: { reserveTokens: 31_999, keepRecentTokens: 1, summarize: request.summarize },
      ...(onEvent && { onEvent })
    })
async function spawn(pi: PiHarness, parent: ThreadId, fork?: ChildSpec['fork']): Promise<ThreadId> {
  const { spawned } = await pi.harness.withCall(parent, (ports) =>
    ports.ledger.transact(parent, () => ({
      ops: [{ type: 'spawn-child', spec: fork ? { ...spec, fork } : spec, key: key('spawn') }],
      effects: [],
      result: null
    }))
  )
  return spawned[0].child
}

describe('coding-agent behavior adapter', () => {
  // Catches a stop made while Pi still prepares a person's prompt (its input handlers run): Pi clears that abort when
  // it starts the run, so unless the adapter repeats it at agent_start the run goes on and asks the model.
  it('stops a run that Pi is still preparing', async () => {
    const gate = latch()
    const pi = await openPiHarness(() => {}, [
      (api) => {
        api.on('input', async () => {
          await gate.promise
          return { action: 'continue' as const }
        })
      }
    ])
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'never' }])
    await pi.harness.sendUser(t, 'go')
    const stopping = pi.harness.withCall(t, (ports) => ports.turns.stop(t, 'user'))
    gate.release()
    await stopping
    const facts = await read(pi, t)
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    expect(facts.history.some((entry) => entry.kind === 'assistant' && entry.text === 'never')).toBe(false)
  })

  // Catches a message that reaches a child while Pi settles its run (after Pi's last steering check) being started by
  // Pi as a run of its own, stranded in Pi's queue, or carried into the child's next run, a run nobody recorded (H3).
  it('withdraws a message that reaches a child while its run settles', async () => {
    const late: { send?: () => Promise<MessageResult>; sent?: Promise<MessageResult> } = {}
    const pi = await openPiHarness(() => {}, [
      (api) => {
        // Not awaited: the run the message would join ends only after this handler.
        api.on('agent_settled', () => {
          late.sent ??= late.send?.()
        })
      }
    ])
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [{ text: 'first' }, { text: 'second' }])
    late.send = () => pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('late'), key('late')))
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work')))
    await pi.harness.settle()
    expect(await late.sent).toEqual({ run: 1, status: 'withdrawn' })
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('late')))).toEqual({
      outcome: 'completed',
      text: 'first'
    })
    expect((await read(pi, parent)).children.get(child)?.runUsage).toHaveLength(1)
    // A run started with the late message would have taken 'second' and written its marker.
    const next = await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('next'), key('next')))
    expect(next).toEqual({ run: 2, status: 'started' })
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 2, key('next')))).toEqual({
      outcome: 'completed',
      text: 'second'
    })
    expect(markerKeys(await read(pi, child))).toEqual([key('work'), key('next')])
  })

  // Catches a steer whose message answers only once the child's run ends instead of when a boundary takes it, which
  // keeps the caller's tool call (message_subagent) waiting for the whole child run (H3).
  it('answers a steer as soon as a boundary of the run takes it', async () => {
    const first = holdTool('first')
    const second = holdTool('second')
    const pi = await openPiHarness((ports) => {
      ports.tools.register(first.tool)
      ports.tools.register(second.tool)
    })
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [
      { text: '', toolCalls: [{ name: 'first', args: {} }] },
      { text: '', toolCalls: [{ name: 'second', args: {} }] },
      { text: 'done' }
    ])
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work')))
    await first.started
    const steer = pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('steer'), key('steer'), 1))
    first.release()
    // The boundary after the first call placed the steer; the run now waits in the second call.
    await second.started
    expect(await Promise.race([steer, Promise.resolve('unanswered')])).toEqual({ run: 1, status: 'queued' })
    second.release()
    await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('work')))
  })

  // Catches a withdrawal that takes the other steers of the run with it (Pi can only clear its whole steering queue):
  // each steer must wait for its own boundary, and only the one whose tool call aborted is withdrawn (H3).
  it('withdraws only the steer whose tool call aborted', async () => {
    const hold = holdTool()
    const steering = latch()
    const sent: { child?: ThreadId; steer?: Promise<MessageResult> } = {}
    const steerer: ToolDefinition = {
      ...tool('steerer'),
      run: async (_call, ports) => {
        sent.steer = ports.helpers.message(sent.child!, input('aborted steer'), key('aborted'), 1)
        steering.release()
        return { text: (await sent.steer).status, isError: false }
      }
    }
    const pi = await openPiHarness((ports) => {
      ports.tools.register(hold.tool)
      ports.tools.register(steerer)
    })
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    sent.child = child
    pi.harness.script(child, [{ text: '', toolCalls: [{ name: 'hold', args: {} }] }, { text: 'child done' }])
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work')))
    await hold.started
    pi.harness.script(parent, [{ text: '', toolCalls: [{ name: 'steerer', args: {} }] }, { text: 'never' }])
    await pi.harness.sendUser(parent, 'go')
    await steering.promise
    const kept = pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('kept'), key('kept'), 1))
    await pi.harness.withCall(parent, (ports) => ports.turns.stop(parent, 'user'))
    expect(await sent.steer).toEqual({ run: 1, status: 'withdrawn' })
    hold.release()
    expect(await kept).toEqual({ run: 1, status: 'queued' })
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('work')))).toEqual({
      outcome: 'completed',
      text: 'child done'
    })
    expect(markerKeys(await read(pi, child))).toEqual([key('work'), key('kept')])
  })

  // Catches a fork that starts the child empty or copies the parent's history past the fork point.
  it('forks a child from the parent history up to the fork point', async () => {
    const pi = await openPiHarness(() => {})
    const parent = await pi.harness.createThread()
    pi.harness.script(parent, [{ text: 'one' }, { text: 'two' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    await pi.harness.sendUser(parent, 'second')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant' && entry.text === 'one')!.id
    const child = await spawn(pi, parent, { from: parent, at })
    const copied = (await read(pi, child)).history.map((entry) =>
      entry.kind === 'assistant' ? entry.text : entry.kind
    )
    expect(copied).toEqual(['user', 'one', 'record'])
  })

  // Catches a fork of a stored (file-backed) parent that starts the child empty, copies history past the fork point
  // or leaves a child that cannot run; every other test forks in memory.
  it('forks a child of a stored parent up to the fork point and runs it', async () => {
    const pi = await openPiHarness(() => {})
    const parent = await pi.behavior.openConversation(SessionManager.create(pi.cwd, join(pi.cwd, 'sessions')))
    pi.harness.script(parent, [{ text: 'one' }, { text: 'two' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    await pi.harness.sendUser(parent, 'second')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant' && entry.text === 'one')!.id
    const child = await spawn(pi, parent, { from: parent, at })
    const copied = (await read(pi, child)).history.map((entry) =>
      entry.kind === 'assistant' ? entry.text : entry.kind
    )
    expect(copied).toEqual(['user', 'one', 'record'])
    pi.harness.script(child, [{ text: 'forked' }])
    const sent = await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('go'), key('go')))
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, sent.run, key('go')))).toEqual(
      { outcome: 'completed', text: 'forked' }
    )
  })

  // Catches onCompacted running while Pi still compacts, where the quiet input it adds (the subagent status after a
  // compaction) is refused as written into a busy conversation.
  it('lets onCompacted add a quiet input once the compaction is over', async () => {
    const pi = await openPiHarness((ports) =>
      ports.lifecycle.register({
        ...noLifecycle,
        onCompacted: async (thread, bound) => {
          await bound.ledger.transact(thread, () => ({
            ops: [{ type: 'append-quiet', thread, input: input('status'), key: key('after-compaction') }],
            effects: [],
            result: null
          }))
        }
      })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first' }])
    await pi.harness.sendUser(t, 'before')
    await pi.harness.settle()
    await pi.harness.compact(t)
    expect((await read(pi, t)).keysSeen.has(key('after-compaction'))).toBe(true)
  })

  // Catches a compaction during a run that the meter never sees or that does not count toward the run's requests, so a
  // child's compactions escape its request cap, a refused one that still asks onCompacting or compacts, or a key that
  // is not the entry the compaction follows, so two compactions would share one memoized summary (H11, H12).
  it('meters a compaction during a run as one of its requests', async () => {
    const metered: number[] = []
    const keys: string[] = []
    const errors: (string | undefined)[] = []
    let refuse = false
    const pi = await openPiHarness(
      (ports) => {
        ports.tools.register(tool('echo'))
        ports.requestMeter.register({
          allow: (_thread, requestsInRun) => {
            metered.push(requestsInRun)
            if (!refuse || requestsInRun !== 1) return { ok: true }
            refuse = false
            return { ok: false, text: 'request cap reached' }
          }
        })
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async (_thread, request) => {
            keys.push(request.key)
            return { summary: 'summary' }
          }
        })
      },
      [],
      autoCompacting((event) => {
        if (event.type === 'compaction-end') errors.push(event.error)
      })
    )
    const t = await pi.harness.createThread()
    // The last reply's usage keeps the context under the threshold: only the compaction before the second request runs.
    const usage = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, costUsd: 0 }
    const round = [
      { text: '', toolCalls: [{ name: 'echo', args: {} }] },
      { text: 'done', usage }
    ]
    pi.harness.script(t, round)
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    // The tool round's request, the compaction before the next request, that request.
    expect(metered).toEqual([0, 1, 2])
    const first = await read(pi, t)
    expect(first.history.map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
      'tool-result',
      'compaction',
      'assistant'
    ])
    expect(keys).toEqual([`${t}:${first.history[2].id}`])
    refuse = true
    pi.harness.script(t, round)
    await pi.harness.sendUser(t, 'again')
    await pi.harness.settle()
    // The refused compaction asks nothing and counts nothing: the next request still sees one.
    expect(metered).toEqual([0, 1, 2, 0, 1, 1])
    expect(keys).toHaveLength(1)
    const second = await read(pi, t)
    expect(second.history.slice(first.history.length).map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
      'tool-result',
      'assistant'
    ])
    expect(errors).toEqual([undefined, 'request cap reached'])
    expect(second.live.runEnd?.outcome).toBe('completed')
  })

  // Catches an automatic compaction that still happens after onCompacting declined it (Pi falls back to its own
  // summarizer on the session model), or a decline whose reason never reaches the host as the compaction's error (H12).
  it('compacts nothing when onCompacting declines an automatic compaction', async () => {
    let compacted = 0
    const ends: AgentRuntimeEvent[] = []
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async () => ({ decline: true, reason: 'The summary is empty' }),
          onCompacted: async () => {
            compacted += 1
          }
        }),
      [],
      autoCompacting((event) => {
        if (event.type === 'compaction-end') ends.push(event)
      })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    const facts = await read(pi, t)
    expect(facts.history.map((entry) => entry.kind)).toEqual(['user', 'assistant'])
    expect(compacted).toBe(0)
    expect(ends).toEqual([expect.objectContaining({ error: 'The summary is empty' })])
    expect(facts.live.runEnd?.outcome).toBe('completed')
  })

  // Catches a session whose compaction bypasses the adapter's summarizer (the host left out `compaction.summarize` or
  // passed its own): Pi would compact with its own or the host's summary and never ask onCompacting (H12).
  it.each<[string, CompactionSummarizer | undefined]>([
    ['without a summarizer', undefined],
    ['with its own summarizer', async () => 'host summary']
  ])('refuses to compact a session built %s', async (_label, summarize) => {
    let asked = 0
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async () => {
            asked += 1
            return { summary: 'summary' }
          }
        }),
      [],
      (request, open) =>
        open(request, {
          compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1, ...(summarize && { summarize }) }
        })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first' }, { text: 'a summary from the session model' }])
    await pi.harness.sendUser(t, 'before')
    await pi.harness.settle()
    await expect(pi.harness.compact(t)).rejects.toThrow()
    expect((await read(pi, t)).history.map((entry) => entry.kind)).toEqual(['user', 'assistant'])
    expect(asked).toBe(0)
    // Pi's own summarizer would have taken the second scripted reply.
    expect(pi.requests(t)).toHaveLength(1)
    expect(pi.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('compaction.summarize') })])
  })

  // Catches a job ensured in onOpen that starts while onOpen is still deciding, instead of once it has run (H12).
  it('starts a job ensured in onOpen only once onOpen has run', async () => {
    const order: string[] = []
    const pi = await openPiHarness((ports) => {
      ports.jobs.register('subagent-report', async () => {
        order.push('job')
      })
      ports.lifecycle.register({
        ...noLifecycle,
        onOpen: async (thread, _open, bound) => {
          const job = { kind: 'subagent-report', scope: thread, input: null, onRestart: 'resume' } as const
          await bound.ledger.transact(thread, () => ({
            ops: [{ type: 'ensure-job', job, key: key('open-job') }],
            effects: [],
            result: null
          }))
          await new Promise((resolve) => setTimeout(resolve, 0))
          order.push('open')
        }
      })
    })
    await pi.harness.createThread()
    await pi.harness.settle()
    expect(order).toEqual(['open', 'job'])
  })

  // Catches a context filter that is consulted but whose omissions never reach the model request or the verifier's
  // context, so an unadmitted goal round would still be sent.
  it('leaves the markers the filter omits out of the request and the model context', async () => {
    let omit: readonly ItemId[] = []
    const pi = await openPiHarness((ports) => ports.contextFilter.register({ omit: () => omit }))
    const t = await pi.harness.createThread()
    await pi.harness.withCall(t, (ports) =>
      ports.ledger.transact(t, () => ({
        ops: [{ type: 'append-quiet', thread: t, input: input('stale round'), key: key('stale') }],
        effects: [],
        result: null
      }))
    )
    omit = [(await read(pi, t)).history.find((entry) => entry.kind === 'marker')!.id]
    pi.harness.script(t, [{ text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    const request = JSON.stringify(pi.requests(t)[0])
    expect(request).toContain('go')
    expect(request).not.toContain('stale round')
    const context = await pi.harness.withCall(t, (ports) => ports.ledger.modelContext(t))
    expect(JSON.stringify(context)).not.toContain('stale round')
  })

  // Catches helpers.stop rejecting for a child of an earlier process (D5: never loaded), which fails onOpen, so a
  // stored conversation whose record says that child was running can no longer be opened.
  it('opens a stored conversation whose onOpen stops a child of an earlier process', async () => {
    let stops = 0
    const pi = await openPiHarness((ports) =>
      ports.lifecycle.register({
        ...noLifecycle,
        onOpen: async (thread, { reopened }, bound) => {
          if (!reopened) return
          for (const entry of (await bound.ledger.read(thread)).history) {
            if (entry.kind !== 'record' || entry.record.type !== 'subagent-run') continue
            if (entry.record.value.status !== 'running') continue
            await bound.helpers.stop(entry.record.value.sessionId, entry.record.value.run)
            stops += 1
          }
        }
      })
    )
    const stored = SessionManager.inMemory(pi.cwd)
    const earlier = runtimeId<'thread'>('earlier-child')
    const record = encodeEntry({ type: 'subagent-run', value: { ...spec.record, sessionId: earlier } }, key('earlier'))
    stored.appendCustomEntry(record.kind, record.data)
    await expect(pi.behavior.openConversation(stored)).resolves.toBe(stored.getSessionId())
    expect(stops).toBe(1)
  })

  // Catches a run another extension starts going unnoticed: it has no run number or end, so the waits resolve while it
  // runs, and the adapter does not drain at its settle, so input submitted while it runs stays stuck.
  it('reports a run the adapter did not start', async () => {
    let foreign: ExtensionAPI | undefined
    const pi = await openPiHarness(() => {}, [
      (api) => {
        foreign = api
      }
    ])
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'foreign' }])
    foreign!.sendMessage({ customType: 'foreign', content: 'go', display: false }, { triggerTurn: true })
    await pi.harness.settle()
    expect(pi.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('did not start') })])
  })

  // Catches a message to a child whose session is still being built recording its key before it fails, so the same
  // key sent again answers 'started' while the child never runs.
  it('keeps the key of a message sent while the child launches', async () => {
    const building = latch()
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        if (request.child) await building.promise
        return open(request)
      }
    )
    const parent = await pi.harness.createThread()
    const spawning = spawn(pi, parent)
    const [child] = (await read(pi, parent)).children.keys()
    const send = () =>
      pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('early'), key('early')))
    await expect(send()).rejects.toThrow()
    building.release()
    await spawning
    pi.harness.script(child, [{ text: 'ran' }])
    expect(await send()).toEqual({ run: 1, status: 'started' })
    expect((await read(pi, parent)).children.get(child)?.running).toBe(true)
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('early')))).toEqual({
      outcome: 'completed',
      text: 'ran'
    })
  })

  // Catches a root session that fails to build staying in the conversation table: opening it again reports it as
  // already open, and close() skips it.
  it('opens a conversation again after its session failed to build', async () => {
    let failing = true
    const pi = await openPiHarness(
      () => {},
      [],
      (request, open) => {
        if (!failing) return open(request)
        failing = false
        return Promise.reject(new Error('build failed'))
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    await expect(pi.behavior.openConversation(manager)).rejects.toThrow('build failed')
    await expect(pi.behavior.openConversation(manager)).resolves.toBe(manager.getSessionId())
  })

  // Catches a person's text submitted while the session is still being built waiting in the inbox forever.
  it('starts text submitted while the session was being built', async () => {
    const building = latch()
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        await building.promise
        return open(request)
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    const t = runtimeId<'thread'>(manager.getSessionId())
    const opening = pi.behavior.openConversation(manager)
    pi.harness.script(t, [{ text: 'answered' }])
    await pi.harness.sendUser(t, 'early')
    building.release()
    await opening
    await pi.harness.settle()
    expect((await read(pi, t)).history.some((entry) => entry.kind === 'assistant' && entry.text === 'answered')).toBe(
      true
    )
  })

  // Catches one session that fails to abort or dispose leaving the others undisposed, the harness open, or a failure
  // unreported.
  it('closes every conversation when one fails to abort and dispose', async () => {
    const closed: ThreadId[] = []
    let first = true
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onClose: async (thread) => {
            closed.push(thread)
          }
        }),
      [],
      async (request, open) => {
        const native = await open(request)
        if (!first) return native
        first = false
        const session = new Proxy(native.session, {
          get: (target, property) =>
            property === 'abort'
              ? () => Promise.reject(new Error('abort failed'))
              : Reflect.get(target, property, target)
        })
        return {
          ...native,
          session,
          dispose: async () => {
            await native.dispose()
            throw new Error('dispose failed')
          }
        }
      }
    )
    const a = await pi.harness.createThread()
    const b = await pi.harness.createThread()
    const failure: unknown = await pi.harness.close().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'abort failed',
      'dispose failed'
    ])
    expect(new Set(closed)).toEqual(new Set([a, b]))
    await expect(pi.harness.createThread()).rejects.toThrow('closed')
  })

  // Catches rule-handler errors Pi swallows never reaching onError: a failing omit sends the request unfiltered, a
  // failing before is just an error result, a failing after leaves the result unreplaced, a failing onClose is lost.
  it('reports what the rule handlers throw', async () => {
    const failures = {
      omit: new Error('omit failed'),
      before: new Error('before failed'),
      after: new Error('after failed'),
      close: new Error('onClose failed')
    }
    const pi = await openPiHarness((ports) => {
      ports.tools.register(tool('refused'))
      ports.tools.register(tool('replaced'))
      ports.contextFilter.register({
        omit: () => {
          throw failures.omit
        }
      })
      ports.toolGate.register({
        before: async (call) => {
          if (call.tool === 'refused') throw failures.before
          return {}
        },
        after: async (call) => {
          if (call.tool === 'replaced') throw failures.after
          return undefined
        }
      })
      ports.lifecycle.register({
        ...noLifecycle,
        onClose: async () => {
          throw failures.close
        }
      })
    })
    const t = await pi.harness.createThread()
    pi.harness.script(t, [
      {
        text: '',
        toolCalls: [
          { name: 'refused', args: {} },
          { name: 'replaced', args: {} }
        ]
      },
      { text: 'done' }
    ])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    await pi.harness.close()
    for (const failure of Object.values(failures)) expect(pi.errors).toContain(failure)
  })

  // Catches a gate's replacement leaving the tool's original structured output for a caller that runs the tool through
  // ctx.executeTool (codemode), which then reads what the gate replaced.
  it('drops the structured content of a result the gate replaced', async () => {
    let seen: unknown = 'not called'
    const parameters = { type: 'object', properties: {} } as unknown as TSchema
    const pi = await openPiHarness(
      (ports) =>
        ports.toolGate.register({
          before: async () => ({}),
          after: async (call) => (call.tool === 'structured' ? { text: 'replaced', isError: false } : undefined)
        }),
      [
        (api) => {
          api.registerTool({
            name: 'structured',
            label: 'structured',
            description: 'structured',
            parameters,
            execute: async () => ({
              content: [{ type: 'text', text: 'raw' }],
              details: {},
              structuredContent: { raw: true }
            })
          })
          api.registerTool({
            name: 'caller',
            label: 'caller',
            description: 'caller',
            parameters,
            async execute(_id, _params, _signal, _onUpdate, ctx) {
              seen = (await ctx.executeTool('structured', {})).result.structuredContent
              return { content: [{ type: 'text', text: 'called' }], details: {} }
            }
          })
        }
      ]
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: '', toolCalls: [{ name: 'caller', args: {} }] }, { text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    expect(seen).toBeUndefined()
  })

  // Catches a quiet input whose write fails once the commit returned (the disk, a session subscriber) ending as an
  // unhandled rejection instead of reaching onError.
  it('reports a quiet input that fails to write', async () => {
    const failure = new Error('subscriber failed')
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        const native = await open(request)
        native.session.subscribe((event) => {
          if (event.type === 'message_end' && event.message.role === 'custom') throw failure
        })
        return native
      }
    )
    const t = await pi.harness.createThread()
    await pi.harness.withCall(t, (ports) =>
      ports.ledger.transact(t, () => ({
        ops: [{ type: 'append-quiet', thread: t, input: input('status'), key: key('quiet') }],
        effects: [],
        result: null
      }))
    )
    await pi.harness.settle()
    expect(pi.errors).toEqual([failure])
  })
})
