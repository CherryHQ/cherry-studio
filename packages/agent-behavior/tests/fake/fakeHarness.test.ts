import { describe, expect, it } from 'vitest'

import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import {
  aborted,
  append,
  callTool,
  childSpec,
  holds,
  key,
  latch,
  noticeTexts,
  read,
  reply,
  status,
  step,
  toolBase,
  toolResults
} from '../../src/contract/fixtures'
import type { JobKind, TxOp } from '../../src/core/decisions'
import { createFakeHarness } from '../../src/fake/fakeHarness'
import { createScriptedHost } from '../../src/fake/scriptedHost'
import type { BoundPorts, LifecycleHandlers, ToolDefinition } from '../../src/ports/harness'

const pendingAfter = <T>(promise: Promise<T>) =>
  Promise.race([
    promise.then(
      () => 'settled',
      () => 'rejected'
    ),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 20))
  ])
const onReopen = (open: (thread: ThreadId, ports: BoundPorts) => Promise<void>): LifecycleHandlers => ({
  onOpen: (thread, { reopened }, ports) => (reopened ? open(thread, ports) : Promise.resolve()),
  onCompacting: async () => ({ summary: 'summary' }),
  onCompacted: async () => {},
  onClose: async () => {}
})

describe('fake harness', () => {
  // Catches a "crash" that lets old work continue, which would make every crash test vacuous.
  it('stops all work at the armed await point until restart', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    fake.crashAt(1)
    const write = fake.withCall(t, (p) => p.ledger.transact(t, () => step([append(t, 'lost', 'lost')], null)))
    await fake.whenCrashed()
    expect(await pendingAfter(write)).toBe('pending')
    await fake.restart()
    expect(noticeTexts(await read(fake, t))).toEqual([])
  })

  // Review focus 4: ports kept from before a restart belong to a dead epoch; they must never settle or write.
  it('never settles or writes through ports kept from before a restart', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    const open = latch()
    const entered = latch()
    let kept: BoundPorts | undefined
    void fake
      .withCall(t, async (p) => {
        kept = p
        entered.release()
        await open.promise
      })
      .catch(() => {})
    await entered.promise
    await fake.restart()
    expect(await pendingAfter(kept!.ledger.transact(t, () => step([append(t, 'late', 'late')], null)))).toBe('pending')
    expect(noticeTexts(await read(fake, t))).toEqual([])
    open.release()
  })

  // Catches the fake diverging from Durable's replay rule (DP K3) that Stage B relies on: stop_subagent is unsafe.
  it('reruns a safe tool and interrupts an unsafe one after a restart', async () => {
    const gate = latch()
    const started = { safe: latch(), unsafe: latch() }
    const runs = { safe: 0, unsafe: 0 }
    const tool = (name: 'safe' | 'unsafe'): ToolDefinition => ({
      ...toolBase(name, name),
      async run(call) {
        runs[name] += 1
        started[name].release()
        await Promise.race([gate.promise, aborted(call.signal)])
        return { text: `${name} done`, isError: false }
      }
    })
    const fake = createFakeHarness({
      install: (p) => {
        p.tools.register(tool('safe'))
        p.tools.register(tool('unsafe'))
      }
    })
    const a = await fake.createThread()
    const b = await fake.createThread()
    fake.script(a, [callTool('unsafe', {}), reply('a done')])
    fake.script(b, [callTool('safe', {}), reply('b done')])
    await fake.sendUser(a, 'go')
    await fake.sendUser(b, 'go')
    await Promise.all([started.safe.promise, started.unsafe.promise])
    await fake.restart()
    gate.release()
    await fake.settle()
    expect(runs).toEqual({ safe: 2, unsafe: 1 })
    expect(toolResults(await read(fake, a))[0]).toMatchObject({
      isError: true,
      text: expect.stringContaining('interrupted')
    })
    expect(toolResults(await read(fake, b))[0]).toMatchObject({ isError: false, text: 'safe done' })
    // The calls cut by the restart finish too, in the dead epoch; their results must not land as well.
    expect([toolResults(await read(fake, a)).length, toolResults(await read(fake, b)).length]).toEqual([1, 1])
  })

  // Catches a filter result the fake ignores, which would let Stage B's D12 tests pass without omitting anything.
  it('leaves omitted ids out of the model request', async () => {
    let omit: ItemId[] = []
    const fake = createFakeHarness({ install: (p) => p.contextFilter.register({ omit: () => omit }) })
    const t = await fake.createThread()
    fake.script(t, [reply('first'), reply('second')])
    await fake.sendUser(t, 'one')
    await fake.settle()
    const first = (await read(fake, t)).history.find((e) => e.kind === 'user')!.id
    omit = [first]
    await fake.sendUser(t, 'two')
    await fake.settle()
    const requests = fake.requestLog(t)
    expect(requests[0]).toContain(first)
    expect(requests[1]).not.toContain(first)
    expect(requests[1].length).toBeGreaterThan(0)
  })

  // Catches a forgotten script hanging a test forever instead of failing it.
  it('fails a run whose script is exhausted', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    await fake.sendUser(t, 'go')
    await fake.settle()
    const facts = await read(fake, t)
    expect(facts.live.runEnd?.outcome).toBe('error')
    expect(facts.history.at(-1)).toMatchObject({ kind: 'assistant', stop: 'error', error: 'script exhausted' })
  })

  // Catches a Stage C test that forgets to register a job handler and then waits forever for the job.
  it('rejects ensure-job for a kind with no registered handler', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    await expect(
      fake.withCall(t, (p) =>
        p.ledger.transact(t, () =>
          step(
            [
              {
                type: 'ensure-job',
                job: { kind: 'idle-driver', scope: t, input: null, onRestart: 'abandon' },
                key: key('j')
              }
            ],
            null
          )
        )
      )
    ).rejects.toThrow()
    expect((await read(fake, t)).keysSeen.has(key('j'))).toBe(false)
  })

  // Catches orchestration spawning a foreground child from a job or host entry, where no tool call can own it.
  it('rejects a foreground spawn outside a tool call', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    await expect(
      fake.withCall(t, (p) =>
        p.ledger.transact(t, () =>
          step([{ type: 'spawn-child', spec: childSpec('foreground', 'fg'), key: key('fg') }], null)
        )
      )
    ).rejects.toThrow()
  })

  // Catches real time leaking into fixtures, which would make Stage B's replay comparisons flaky.
  it('keeps a fixed clock', async () => {
    const fake = createFakeHarness()
    const t = await fake.createThread()
    expect(await fake.withCall(t, async (p) => p.clock.now())).toBe(0)
  })

  // Catches a job ensured inside onOpen running twice, or before reopen completes (Durable runs no task before resume).
  it('starts each job ensured in onOpen once, after the last onOpen', async () => {
    const events: string[] = []
    let ensured = false
    const ensure = (thread: ThreadId, kind: JobKind, onRestart: 'resume' | 'abandon'): TxOp => ({
      type: 'ensure-job',
      job: { kind, scope: thread, input: null, onRestart },
      key: key(`open-${onRestart}`)
    })
    const fake = createFakeHarness({
      install: (p) => {
        p.jobs.register('subagent-report', async () => {
          events.push('job:resume')
        })
        p.jobs.register('idle-driver', async () => {
          events.push('job:abandon')
        })
        p.lifecycle.register(
          onReopen(async (thread, ports) => {
            if (!ensured) {
              ensured = true
              await ports.ledger.transact(thread, () =>
                step([ensure(thread, 'subagent-report', 'resume'), ensure(thread, 'idle-driver', 'abandon')], null)
              )
            }
            // A port call passes an await point, where a job started too early would run.
            await ports.ledger.read(thread)
            events.push('opened')
          })
        )
      }
    })
    await fake.createThread()
    await fake.createThread()
    await fake.restart()
    await fake.settle()
    expect(events.slice(0, 2)).toEqual(['opened', 'opened'])
    expect(events.slice(2).sort()).toEqual(['job:abandon', 'job:resume'])
  })

  // Catches onOpen logic that treats a just-stopped run as idle, which Durable rejects at commit.
  it('shows a run stopped in onOpen as active until resume ends it', async () => {
    const hold = holds()
    const seen: { idle?: boolean; quiet?: string } = {}
    const fake = createFakeHarness({
      install: (p) => {
        p.tools.register(hold.tool)
        p.lifecycle.register(
          onReopen(async (thread, ports) => {
            await ports.turns.stop(thread, 'goal-pause')
            seen.idle = (await ports.ledger.read(thread)).live.idle
            seen.quiet = await ports.ledger
              .transact(thread, () =>
                step([{ type: 'append-quiet', thread, input: status('quiet'), key: key('quiet') }], null)
              )
              .then(
                () => 'applied',
                () => 'refused'
              )
          })
        )
      }
    })
    const t = await fake.createThread()
    fake.script(t, [callTool('hold', { id: 'stopped' }), reply('after restart')])
    await fake.sendUser(t, 'go')
    await hold.started('stopped')
    await fake.restart()
    await fake.settle()
    expect(seen).toEqual({ idle: false, quiet: 'refused' })
    expect((await read(fake, t)).live.runEnd?.outcome).toBe('aborted')
    expect(hold.invocations('stopped')).toBe(1)
  })

  // Catches onOpen handlers that submit or wait, which on Durable silently enable scheduling.
  it('rejects a submit or a wait from onOpen on reopen', async () => {
    const answers: string[] = []
    const fake = createFakeHarness({
      install: (p) =>
        p.lifecycle.register(
          onReopen(async (thread, ports) => {
            const calls = [
              () => ports.turns.start(thread, status('submitted'), key('open-start')),
              () => ports.waits.untilIdle(thread)
            ]
            for (const call of calls)
              await call().then(
                () => answers.push('allowed'),
                (error: Error) => answers.push(error.message)
              )
          })
        )
    })
    const t = await fake.createThread()
    await fake.restart()
    expect(answers).toEqual([
      expect.stringMatching(/^turns\.start .*onOpen/),
      expect.stringMatching(/^waits\.untilIdle .*onOpen/)
    ])
    expect((await read(fake, t)).history).toEqual([])
  })

  // Catches a restart that leaves the dead epoch's host waits pending: the obsolete question stays first in the
  // scripted host's queue and takes the answer meant for the resumed call, which then waits for a second one.
  it("retires the dead epoch's host waits on restart and keeps the restored run going", async () => {
    const host = createScriptedHost({
      settings: {
        goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
        autonomy: 'auto',
        permissionMode: 'default',
        attendance: 'stream',
        maxBackground: 2,
        offloadThreshold: 4000
      }
    })
    const asked = latch()
    const ask: ToolDefinition = {
      ...toolBase('ask'),
      async run(call) {
        asked.release()
        const answer = await host.questions.ask(
          { call: { thread: call.thread, key: call.key }, questions: [] },
          call.signal
        )
        return { text: answer.status, isError: false }
      }
    }
    const fake = createFakeHarness({ install: (p) => p.tools.register(ask) })
    const t = await fake.createThread()
    fake.script(t, [callTool('ask', {}), reply('done')])
    await fake.sendUser(t, 'go')
    await asked.promise
    await fake.restart()
    host.answerQuestion({ status: 'declined' })
    expect(await pendingAfter(fake.settle())).toBe('settled')
    const facts = await read(fake, t)
    expect(toolResults(facts)).toMatchObject([{ isError: false, text: 'declined' }])
    expect(facts.live.runEnd?.outcome).toBe('completed')
  })

  // Catches compaction requests escaping a child's request cap (PR-2a ruling G5): a compaction during a run is one of
  // its model requests, so the meter sees it and counts it.
  it('meters a compaction during a run as one of its requests', async () => {
    const hold = holds()
    const seen: number[] = []
    const fake = createFakeHarness({
      install: (p) => {
        p.tools.register(hold.tool)
        p.requestMeter.register({ allow: (_thread, requests) => (seen.push(requests), { ok: true }) })
        p.lifecycle.register(onReopen(async () => {}))
      }
    })
    const t = await fake.createThread()
    fake.script(t, [callTool('hold', { id: 'h' }), reply('done')])
    await fake.sendUser(t, 'go')
    await hold.started('h')
    await fake.compact(t)
    hold.release('h')
    await fake.settle()
    expect(seen).toEqual([0, 1, 2])
  })
})
