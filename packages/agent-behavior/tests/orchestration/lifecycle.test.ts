import { describe, expect, it } from 'vitest'

import { callTool, holds, reply, toolBase } from '../../src/contract/fixtures'
import { currentGoal } from '../../src/core/goal/goalHistory'
import { MAX_SUBAGENT_REQUESTS } from '../../src/core/subagents/subagentText'
import { markers, runRecords, world } from './world'

const compactions = async (w: ReturnType<typeof world>, thread: Parameters<ReturnType<typeof world>['read']>[0]) =>
  (await w.read(thread)).history.filter((entry) => entry.kind === 'compaction')

describe('lifecycle handlers', () => {
  // Catches a compaction the package was never asked about, or a summary not kept for a rerun of the same compaction
  // (I-d: on Durable the select phase reruns after a crash).
  it('compacts with the host summary and keeps it under the compaction key', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [reply('first')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const last = (await w.read(t)).history.at(-1)!.id
    w.host.giveSummary('what happened so far')
    await w.fake.compact(t)
    expect(await compactions(w, t)).toHaveLength(1)
    expect(w.host.asked.summaries).toBe(1)
    expect(JSON.stringify(w.fake.persistentLog())).toContain(`cherry.summary:${t}:${last}`)
  })

  // Catches a failed or empty summary that compacts anyway, losing the context with nothing in its place (D33).
  it('declines a compaction whose summary fails or is empty', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [reply('first'), reply('second')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    await w.fake.compact(t)
    await w.fake.sendUser(t, 'more')
    await w.fake.settle()
    w.host.giveSummary('   ')
    await w.fake.compact(t)
    expect(await compactions(w, t)).toHaveLength(0)
    expect(w.host.asked.summaries).toBe(2)
  })

  // Catches an empty summary kept under the compaction key: a retry of the same compaction would decline again without
  // asking the host (D33).
  it('asks the host again after an empty summary', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [reply('first')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    w.host.giveSummary('   ')
    await w.fake.compact(t)
    w.host.giveSummary('a real summary')
    await w.fake.compact(t)
    expect(await compactions(w, t)).toHaveLength(1)
    expect(w.host.asked.summaries).toBe(2)
  })

  // Catches a compaction that goes through while the run is over its request cap: one more model request the cap
  // never stopped (D24, H11).
  it('a request-meter refusal cancels an in-run compaction', async () => {
    const hold = holds()
    const echo = callTool('echo', {})
    const w = world({
      extra: (p) => {
        p.tools.register(hold.tool)
        p.tools.register({ ...toolBase('echo'), run: async () => ({ text: 'ran', isError: false }) })
      },
      scripts: (_t, lineage) =>
        lineage.kind === 'subagent'
          ? [...Array.from({ length: MAX_SUBAGENT_REQUESTS - 1 }, () => echo), callTool('hold', { id: 'child' })]
          : []
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('subagent', { description: 'scan', prompt: 'scan', background: true }), reply('wait')])
    await w.fake.sendUser(t, 'go')
    await hold.started('child')
    const [{ sessionId: child }] = runRecords(await w.read(t))
    w.host.giveSummary('summary')
    await w.fake.compact(child)
    expect(await compactions(w, child)).toHaveLength(0)
    expect(w.host.asked.summaries).toBe(0)
  })

  // Catches onCompacted writing nothing or writing while a run is active: the model would lose track of the
  // background children the compaction folded away (S-i, D26).
  it('leaves the subagent status for the driver to write once idle', async () => {
    const hold = holds()
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply('done')] : [])
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [
      callTool('subagent', { description: 'scan', prompt: 'scan', background: true }),
      callTool('hold', { id: 'parent' }),
      reply('wait')
    ])
    w.fake.script(t, [reply('read it')])
    await w.fake.sendUser(t, 'go')
    await hold.started('child')
    await hold.started('parent')
    w.host.giveSummary('summary')
    await w.fake.compact(t)
    expect(markers(await w.read(t), 'subagent-status')).toEqual([])
    hold.release('parent')
    await w.enter(t, (_entries, ports) => ports.waits.untilIdle(t))
    hold.release('child')
    await w.fake.settle()
    const [status, ...more] = markers(await w.read(t), 'subagent-status')
    expect(more).toHaveLength(0)
    expect(status.text).toContain('"scan"')
    expect(status.text).toContain('running')
  })

  // Catches onOpen not consulting the host's tool support: a goal would drive rounds its model cannot act in (X2).
  it('stops a goal on reopen once its model cannot call tools', async () => {
    const hold = holds()
    let tools = true
    const w = world({
      extra: (p) => p.tools.register(hold.tool),
      patchHost: (host) => ({
        ...host,
        models: {
          ...host.models,
          current: async (thread) => ({ ...(await host.models.current(thread)), supportsTools: tools })
        }
      })
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('hold', { id: 'round' }), reply('never')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await hold.started('round')
    tools = false
    await w.fake.restart()
    await w.fake.settle()
    expect(currentGoal((await w.read(t)).history)?.lastStop?.code).toBe('unsupported_model')
  })
})
