import { describe, expect, it } from 'vitest'

import type { ItemId } from '@cherrystudio/agent-runtime'

import {
  aborted,
  append,
  callTool,
  childSpec,
  key,
  latch,
  noticeTexts,
  read,
  reply,
  step,
  toolBase,
  toolResults
} from '../../src/contract/fixtures'
import { createFakeHarness } from '../../src/fake/fakeHarness'
import type { BoundPorts, ToolDefinition } from '../../src/ports/harness'

const pendingAfter = <T>(promise: Promise<T>) =>
  Promise.race([
    promise.then(
      () => 'settled',
      () => 'rejected'
    ),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 20))
  ])

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
  it('keeps a manual clock', async () => {
    const fake = createFakeHarness({ now: 1000 })
    const t = await fake.createThread()
    expect(await fake.withCall(t, async (p) => p.clock.now())).toBe(1000)
    fake.advanceClock(250)
    expect(await fake.withCall(t, async (p) => p.clock.now())).toBe(1250)
  })
})
