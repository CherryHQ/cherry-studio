import { describe, expect, it, vi } from 'vitest'

import type { ThreadId } from '@cherrystudio/agent-runtime'

import { callTool, holds, latch, markersWith, reply, toolResults } from '../../src/contract/fixtures'
import { offloadName } from '../../src/core/context/offload'
import { type CallKey, callKeyOf } from '../../src/core/facts'
import { keys } from '../../src/core/keys'
import { capText, notDeliveredText, startedText } from '../../src/core/subagents/subagentText'
import type { ToolDefinition } from '../../src/ports/harness'
import { markers, records, runRecords, world, wrapJob, wrapTool } from './world'

const SPAWN = { description: 'scan', prompt: 'scan the repo' }
const BACKGROUND = { ...SPAWN, background: true }
// The fake numbers threads in creation order: the parent is thread-1, its first child thread-2.
const CHILD = 'thread-2' as ThreadId
const childInputs = async (w: ReturnType<typeof world>, child: ThreadId) =>
  markers(await w.read(child), 'subagent-message').length

/** The report job's first `read` (or `message`) waits until `release`, so the model's stop lands before it. */
function heldReportJob(method: 'read' | 'message') {
  const gate = latch()
  const wrap = wrapJob('subagent-report', (ports) =>
    method === 'read'
      ? {
          ...ports,
          ledger: { ...ports.ledger, read: async (thread) => gate.promise.then(() => ports.ledger.read(thread)) }
        }
      : {
          ...ports,
          helpers: {
            ...ports.helpers,
            message: async (child, input, key) => gate.promise.then(() => ports.helpers.message(child, input, key))
          }
        }
  )
  return { wrap, release: gate.release }
}
const stopAnswered = (w: ReturnType<typeof world>, thread: ThreadId) =>
  vi.waitFor(async () =>
    expect(
      (await w.read(thread)).history.some((entry) => entry.kind === 'tool-result' && entry.tool === 'stop_subagent')
    ).toBe(true)
  )

describe('subagent tools', () => {
  // Catches a foreground child never messaged or awaited, or its end left unrecorded so its delegation stays active.
  it('a foreground subagent answers in the call and records its end', async () => {
    const w = world({ scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('found 3 files')] : []) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', SPAWN), reply('done')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const facts = await w.read(t)
    const result = facts.history.find((entry) => entry.kind === 'tool-result')
    expect(result).toMatchObject({ isError: false })
    expect(result?.kind === 'tool-result' && result.text).toContain('found 3 files')
    expect(runRecords(facts).at(-1)).toMatchObject({ sessionId: CHILD, status: 'finished', outcome: 'completed' })
    expect(await childInputs(w, CHILD)).toBe(1)
  })

  // Catches a background result lost or delivered twice (fixture 1's live half): the job records the end once and the
  // driver delivers it in one notification turn.
  it('a background subagent reports once through its job and the driver', async () => {
    const w = world({ scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('found 3 files')] : []) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), reply('waiting'), reply('read the report')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const facts = await w.read(t)
    const started = facts.history.find((entry) => entry.kind === 'tool-result')
    expect(started?.kind === 'tool-result' && started.text).toBe(startedText(CHILD))
    const [notification] = markers(facts, 'subagent-notification')
    expect(markers(facts, 'subagent-notification')).toHaveLength(1)
    expect(notification.marker.runs).toEqual([{ sessionId: CHILD, run: 1, outcome: 'completed' }])
    expect(notification.text).toContain('found 3 files')
    expect(w.host.emitted.filter((event) => event.type === 'subagents').at(-1)).toMatchObject({
      views: [{ sessionId: CHILD, status: 'finished', outcome: 'completed' }]
    })
  })

  // Catches a notification carrying an unbounded report into the parent's context (D22).
  it('saves a long report and delivers its marker', async () => {
    const long = 'line\n'.repeat(1200)
    const w = world({
      settings: { offloadThreshold: 1000 },
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply(long)] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), reply('waiting'), reply('read it')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    expect(w.host.saved.map(({ name, tool }) => [name, tool])).toEqual([[offloadName(long.trim()), 'subagent']])
    expect(runRecords(await w.read(t)).at(-1)?.report).toContain('<persisted-output>')
  })

  // Catches a continuation that starts no run, starts it in the foreground, or never reports (D17, AC10).
  it('message_subagent continues a finished background child as its next run', async () => {
    const w = world({
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('first'), reply('second')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', BACKGROUND),
      reply('waiting'),
      callTool('message_subagent', { id: CHILD, message: 'one more thing' }),
      reply('waiting again'),
      reply('read both')
    ])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const facts = await w.read(t)
    expect(markers(facts, 'subagent-notification').flatMap(({ marker }) => marker.runs.map(({ run }) => run))).toEqual([
      1, 2
    ])
    expect(await childInputs(w, CHILD)).toBe(2)
  })

  // Catches S-j's wiring (AC10): a finished foreground child that is not forked into a new background child, a report
  // job that cannot find that child by the continuation's key, or a later message on the old id that misses it.
  it('message_subagent forks a finished foreground child and forwards its old id to the fork', async () => {
    const w = world({
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('done once'), reply('done again')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', SPAWN),
      callTool('message_subagent', { id: CHILD, message: 'more' }),
      reply('waiting'),
      callTool('message_subagent', { id: CHILD, message: 'even more' }),
      reply('waiting again'),
      reply('read both')
    ])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const facts = await w.read(t)
    const fork = runRecords(facts).find(({ sessionId }) => sessionId !== CHILD)?.sessionId
    expect(fork).toBeDefined()
    expect(toolResults(facts).filter(({ tool }) => tool === 'message_subagent')).toMatchObject([
      { isError: false, details: { sessionId: fork, continued: true } },
      { isError: false, details: { sessionId: fork, continued: true } }
    ])
    expect(
      markers(facts, 'subagent-notification').flatMap(({ marker }) =>
        marker.runs.map(({ sessionId, run }) => [sessionId, run])
      )
    ).toEqual([
      [fork, 1],
      [fork, 2]
    ])
    expect(facts.children.get(CHILD)?.runUsage).toHaveLength(1)
  })

  // Catches a steer that reaches a run already ended starting a run the parent never records (G-C5): the message must
  // continue the child as a recorded run whose result is delivered.
  it('message_subagent continues the child when its run ends before the steer arrives', async () => {
    const hold = holds()
    const lateSteer = wrapTool('message_subagent', (run) => (call, ports) => {
      // Released for every message, so a steer sent without its run fails here instead of waiting on the held run.
      const message: typeof ports.helpers.message = async (child, input, key, steered) => {
        hold.release('child')
        await ports.waits.untilIdle(child)
        return ports.helpers.message(child, input, key, steered)
      }
      return run(call, { ...ports, helpers: { ...ports.helpers, message } })
    })
    const w = world({
      wrap: lateSteer,
      extra: (p) => p.tools.register(hold.tool),
      scripts: (_t, lineage) =>
        lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply('first'), reply('second')] : []
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', BACKGROUND),
      callTool('message_subagent', { id: CHILD, message: 'one more thing' }),
      reply('waiting'),
      reply('read both'),
      reply('done')
    ])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const facts = await w.read(t)
    expect(toolResults(facts).at(-1)).toMatchObject({ details: { sessionId: CHILD, continued: true } })
    expect(
      runRecords(facts)
        .filter(({ status }) => status === 'finished')
        .map(({ run }) => run)
    ).toEqual([1, 2])
    expect(facts.children.get(CHILD)?.runUsage).toHaveLength(2)
  })

  // Catches a steer its run ended without taking being silently dropped (the tool answering 'queued' for a message
  // nobody reads) or carried into a run the parent never records (G-C5).
  it('message_subagent continues the child when its run ends before a boundary takes the steer', async () => {
    const hold = holds()
    const steerSent = latch()
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      wrap: wrapTool('message_subagent', (run) => (call, ports) => {
        const message: typeof ports.helpers.message = (child, input, key, steered) => {
          const answer = ports.helpers.message(child, input, key, steered)
          if (steered !== undefined) steerSent.release()
          return answer
        }
        return run(call, { ...ports, helpers: { ...ports.helpers, message } })
      }),
      scripts: (_t, lineage) =>
        lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply('second')] : []
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', BACKGROUND),
      callTool('message_subagent', { id: CHILD, message: 'one more thing' }),
      reply('waiting'),
      reply('read one'),
      reply('read two')
    ])
    await w.fake.sendUser(t, 'go')
    await steerSent.promise
    // The run ends (the harness aborts it) while the steer waits for its next boundary.
    await w.enter(t, (_entries, ports) => ports.helpers.stop(CHILD, 1))
    await w.fake.settle()
    const facts = await w.read(t)
    expect(toolResults(facts).find(({ tool }) => tool === 'message_subagent')).toMatchObject({
      details: { sessionId: CHILD, continued: true }
    })
    expect(
      runRecords(facts)
        .filter(({ status }) => status === 'finished')
        .map(({ run, outcome }) => [run, outcome])
    ).toEqual([
      [1, 'aborted'],
      [2, 'completed']
    ])
    expect(facts.children.get(CHILD)?.runUsage).toHaveLength(2)
    const child = await w.read(CHILD)
    const steers = child.history.filter((entry) => entry.kind === 'marker' && entry.key?.startsWith('subagent-steer:'))
    expect(steers).toEqual([])
    expect(markers(child, 'subagent-message').at(-1)?.text).toContain('one more thing')
  })

  // Catches a person's stop that waits on a steer (H3): the steer's call holds the parent's run until the child's next
  // boundary, and a steer the stop withdrew, decided again without the abort check, spins on its spent key.
  it('a user stop withdraws a waiting steer at once and message_subagent reports it undelivered', async () => {
    const hold = holds()
    const steerSent = latch()
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      wrap: wrapTool('message_subagent', (run) => (call, ports) => {
        const message: typeof ports.helpers.message = (child, input, key, steered) => {
          const answer = ports.helpers.message(child, input, key, steered)
          if (steered !== undefined) steerSent.release()
          return answer
        }
        return run(call, { ...ports, helpers: { ...ports.helpers, message } })
      }),
      scripts: (_t, lineage) =>
        lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply('child done')] : []
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', BACKGROUND),
      callTool('hold', { id: 'parent' }),
      callTool('message_subagent', { id: CHILD, message: 'also this' }),
      reply('never')
    ])
    await w.fake.sendUser(t, 'go')
    await Promise.all([hold.started('parent'), hold.started('child')])
    hold.release('parent')
    await steerSent.promise
    let stopped = false
    const stop = w
      .enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
      .then(() => {
        stopped = true
      })
    // The fake answers in microtasks: a stop that does not wait on the child has returned one macrotask later.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stopped).toBe(true)
    await stop
    expect(toolResults(await w.read(t)).find(({ tool }) => tool === 'message_subagent')).toMatchObject({
      text: notDeliveredText(CHILD),
      isError: true
    })
    hold.release('child')
    await w.fake.settle()
    expect((await w.read(t)).children.get(CHILD)?.runUsage).toHaveLength(1)
    expect(await childInputs(w, CHILD)).toBe(1)
  })

  // Catches a decision again after a withdrawn steer reusing that steer's key on a later run (G-C5): the harness keeps
  // answering it 'withdrawn', so the tool decides again while that run lasts (cut off at 20 commits) and never steers it.
  it('message_subagent steers a later run under a new key once its first steer was withdrawn', async () => {
    const hold = holds()
    const second = callKeyOf('message-2')
    const steeredTwo = latch()
    let messageRun: ToolDefinition['run'] | undefined
    let commits = 0
    let steersForOne = 0
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      wrap: wrapTool('message_subagent', (run) => {
        messageRun = (call, ports) => {
          const transact: typeof ports.ledger.transact = (thread, decide) => {
            commits += 1
            if (commits > 20) return Promise.reject(new Error('message_subagent kept deciding'))
            return ports.ledger.transact(thread, decide)
          }
          const message: typeof ports.helpers.message = async (child, input, key, steered) => {
            // Run 1 ends once both calls steered it, before either steer reaches it.
            if (steered === 1) {
              steersForOne += 1
              if (steersForOne === 2) hold.release('one')
              await ports.waits.untilIdle(child)
            }
            const answer = ports.helpers.message(child, input, key, steered)
            if (steered === 2) steeredTwo.release()
            // The second call decides again only once the first call's continuation is running.
            if (call.key === second && steered === 1) await hold.started('two')
            return answer
          }
          return run(call, { ...ports, ledger: { ...ports.ledger, transact }, helpers: { ...ports.helpers, message } })
        }
        return messageRun
      }),
      scripts: (_t, lineage) =>
        lineage.kind === 'subagent'
          ? [callTool('hold', { id: 'one' }), reply('first'), callTool('hold', { id: 'two' }), reply('second')]
          : []
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), reply('waiting'), reply('read one'), reply('read two')])
    await w.fake.sendUser(t, 'go')
    await hold.started('one')
    const send = (call: CallKey) =>
      w.enter(t, (_entries, ports) =>
        messageRun!(
          { key: call, thread: t, args: { id: CHILD, message: call }, signal: new AbortController().signal },
          ports
        )
      )
    const sent = Promise.all([send(callKeyOf('message-1')), send(second)])
    await steeredTwo.promise
    hold.release('two')
    const [first, later] = await sent
    await w.fake.settle()
    expect(first).toMatchObject({ details: { sessionId: CHILD, continued: true } })
    expect(later).toMatchObject({ details: { sessionId: CHILD, continued: false } })
    expect(markersWith(await w.read(CHILD), keys.subagentSteer(second, 2))).toHaveLength(1)
    expect((await w.read(t)).children.get(CHILD)?.runUsage).toHaveLength(2)
  })

  // Catches the slot check made outside the commit (S-e): spawns that run at once would all see a free slot. The fake
  // runs one reply's calls in order, so this runs the tool itself three times at once.
  it('lets no more background spawns than the cap through when they run at once', async () => {
    const hold = holds()
    let spawnRun: ToolDefinition['run'] | undefined
    const w = world({
      settings: { maxBackground: 2 },
      extra: (p) => p.tools.register(hold.tool),
      wrap: wrapTool('subagent', (run) => {
        spawnRun = run
        return run
      }),
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [callTool('hold', { id: 'children' }), reply('x')] : [])
    })
    const t = await w.fake.createThread()
    const spawn = (n: number) =>
      w.enter(t, (_entries, ports) =>
        spawnRun!(
          { key: callKeyOf(`spawn-${n}`), thread: t, args: BACKGROUND, signal: new AbortController().signal },
          ports
        )
      )
    const results = await Promise.all([spawn(1), spawn(2), spawn(3)])
    expect(results.filter(({ isError }) => isError)).toEqual([{ text: capText(2), isError: true }])
    expect(runRecords(await w.read(t))).toHaveLength(2)
    hold.release('children')
    await w.fake.settle()
  })

  // Catches a named model ignored: the child would run on the default model the host gave (D16).
  it('spawns a child on the model the call names', async () => {
    const sonnet = { key: 'anthropic/sonnet', provider: 'Anthropic', model: 'Sonnet', exact: true }
    const w = world({
      host: { models: [sonnet] },
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('done')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', { ...SPAWN, model: 'Sonnet' }), reply('ok')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    expect(runRecords(await w.read(t)).at(-1)).toMatchObject({ modelKey: 'anthropic/sonnet' })
  })

  // Catches a model-stopped run that still notifies, or a stop that does not wait for the partial output (D18).
  it('stop_subagent stops a running child and returns its partial output', async () => {
    const hold = holds()
    const working = { text: 'half done', toolCalls: [{ name: 'hold', args: { id: 'child' } }] }
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [working, reply('x')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', BACKGROUND),
      callTool('hold', { id: 'parent' }),
      callTool('stop_subagent', { id: CHILD }),
      reply('stopped it')
    ])
    await w.fake.sendUser(t, 'go')
    await hold.started('child')
    hold.release('parent')
    await w.fake.settle()
    const facts = await w.read(t)
    const stopped = facts.history.filter((entry) => entry.kind === 'tool-result').at(-1)
    expect(stopped).toMatchObject({ isError: false, details: { sessionId: CHILD, stopped: true, run: 1 } })
    expect(stopped?.kind === 'tool-result' && stopped.text).toContain('half done')
    expect(runRecords(facts).at(-1)).toMatchObject({ stoppedBy: 'model', status: 'finished', outcome: 'stopped' })
    expect(markers(facts, 'subagent-notification')).toHaveLength(0)
  })
})

describe('a stop before the first input (G-C4)', () => {
  // Catches a stop that waits for a run no input has reached: the tool would wait for an answer that never comes, and
  // the report job would start the stopped run anyway.
  it('ends a background run the model stops before its first input, without starting it', async () => {
    const held = heldReportJob('read')
    const w = world({ wrap: held.wrap, scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('ran')] : []) })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), callTool('stop_subagent', { id: CHILD }), reply('stopped')])
    await w.fake.sendUser(t, 'go')
    await stopAnswered(w, t)
    held.release()
    await w.fake.settle()
    const facts = await w.read(t)
    const stopResult = facts.history.find((entry) => entry.kind === 'tool-result' && entry.tool === 'stop_subagent')
    expect(stopResult).toMatchObject({ isError: false, details: { sessionId: CHILD, stopped: true } })
    expect(runRecords(facts).at(-1)).toMatchObject({ status: 'finished', outcome: 'stopped' })
    expect(await childInputs(w, CHILD)).toBe(0)
  })

  // Catches an input that raced past a stop: the stopped run would do its work after all.
  it('stops at once a run whose first input arrives after the model stopped it', async () => {
    const hold = holds()
    const held = heldReportJob('message')
    const w = world({
      wrap: held.wrap,
      extra: (p) => p.tools.register(hold.tool),
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply('ran')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), callTool('stop_subagent', { id: CHILD }), reply('stopped')])
    await w.fake.sendUser(t, 'go')
    await stopAnswered(w, t)
    held.release()
    await w.fake.settle()
    expect(runRecords(await w.read(t)).filter(({ status }) => status === 'finished')).toMatchObject([
      { outcome: 'stopped' }
    ])
    const child = await w.read(CHILD)
    expect(child.live.runEnd?.outcome).toBe('aborted')
    expect(child.history.some((entry) => entry.kind === 'assistant' && entry.text === 'ran')).toBe(false)
  })
})

describe('stopSubagent entry', () => {
  // Catches D27 routed the wrong way: a background child must stop alone; a foreground child's stop is its parent's
  // turn stopping, recorded as a person's stop.
  it('stops a background child alone and a foreground child with its parent turn', async () => {
    const hold = holds()
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      scripts: (thread, lineage) => (lineage.kind === 'subagent' ? [callTool('hold', { id: thread }), reply('x')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', BACKGROUND), callTool('subagent', SPAWN), reply('never')])
    await w.fake.sendUser(t, 'go')
    await hold.started('thread-2')
    await hold.started('thread-3')
    const background = await w.enter(t, (entries, ports) => entries.stopSubagent(ports, CHILD, 'stop-bg'))
    const foreground = await w.enter(t, (entries, ports) =>
      entries.stopSubagent(ports, 'thread-3' as ThreadId, 'stop-fg')
    )
    await w.fake.settle()
    const facts = await w.read(t)
    expect([background, foreground]).toEqual(['stopped-child', 'stopped-turn'])
    expect(records(facts, 'turn-stop').map(({ value }) => value.cause)).toEqual(['user'])
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    const latest = new Map(runRecords(facts).map((record) => [record.sessionId, record]))
    expect(latest.get(CHILD)).toMatchObject({ stoppedBy: 'user', outcome: 'stopped' })
    expect(latest.get('thread-3' as ThreadId)).toMatchObject({ status: 'finished', outcome: 'aborted' })
  })

  // Catches a finished foreground child routed to its parent (D27): its record still says foreground, so stopping it
  // aborted a later, unrelated turn of the parent.
  it('answers not-running for a finished foreground child and leaves the parent turn running', async () => {
    const hold = holds()
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('child done')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', SPAWN),
      reply('first done'),
      callTool('hold', { id: 'second' }),
      reply('second done')
    ])
    await w.fake.sendUser(t, 'first')
    await w.fake.settle()
    await w.fake.sendUser(t, 'second')
    await hold.started('second')
    const stopped = await w.enter(t, (entries, ports) => entries.stopSubagent(ports, CHILD, 'stop-1'))
    hold.release('second')
    await w.fake.settle()
    const facts = await w.read(t)
    expect(stopped).toBe('not-running')
    expect(facts.live.runEnd?.outcome).toBe('completed')
    expect(records(facts, 'turn-stop')).toEqual([])
  })
})
