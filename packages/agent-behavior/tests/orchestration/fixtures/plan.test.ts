import { expect } from 'vitest'

import { callTool, reply } from '../../../src/contract/fixtures'
import { PLAN_BLOCK } from '../../../src/core/approval/approval'
import { ensureDriver } from '../../../src/core/driver/jobs'
import type { ConversationFacts, ToolCallFact } from '../../../src/core/facts'
import type { CallRef } from '../../../src/core/hostFacts'
import type { Key } from '../../../src/core/keys'
import type { HarnessPorts } from '../../../src/ports/harness'
import { ALLOWED, markers, type World } from '../world'
import { describeScenario } from './scenario'

// PR-3d brings enter_plan_mode and exit_plan_mode, the writers of `cherry.plan`; until then this fixture writes the
// record as they will, and exit_plan_mode's rejected exits (with and without feedback) wait for that PR.
const plan = (w: World, thread: ConversationFacts['thread'], active: boolean) =>
  w.enter(thread, (_entries, ports) =>
    ports.ledger.transact(thread, (facts) => ({
      ops: [
        {
          type: 'append-record',
          thread,
          record: { type: 'plan', value: { active, at: 0 } },
          key: `test:plan:${active}` as Key
        },
        ...(active ? [] : [ensureDriver(facts)])
      ],
      effects: [],
      result: null
    }))
  )
const edits = (_call: CallRef, tool: ToolCallFact) =>
  tool.name === 'write' ? { ...ALLOWED, category: 'edit' as const } : ALLOWED
const register = (ports: HarnessPorts) =>
  ports.tools.register({
    name: 'write',
    description: 'write',
    schema: { type: 'object' },
    replay: 'safe',
    executionMode: 'sequential',
    availability: 'all',
    modelOnly: true,
    run: async () => ({ text: 'written', isError: false })
  })

// Fixture 10.
describeScenario({
  name: 'plan mode holds the goal and blocks edits until it ends',
  catches: 'an edit or a goal round while planning, or a goal left still after planning ends (D37, G-c)',
  options: {
    settings: { goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 } },
    host: { approvalFacts: edits },
    extra: register
  },
  async setup(w) {
    const thread = await w.fake.createThread()
    w.fake.script(thread, [callTool('write', { path: 'a.ts' }), reply('planning only'), reply('round 1 done')])
    await plan(w, thread, true)
    return { thread }
  },
  async drive(w, { thread }) {
    await w.enter(thread, (entries, ports) => entries.goalCommand(ports, thread, 'ship it', 'cmd-1'))
    await w.fake.sendUser(thread, 'edit a.ts')
    await w.fake.settle()
    await plan(w, thread, false)
    await w.fake.settle()
  },
  async expect(w, { thread }, crashed) {
    const facts = await w.read(thread)
    const off = facts.history.findIndex(
      (entry) => entry.kind === 'record' && entry.record.type === 'plan' && !entry.record.value.active
    )
    const written = facts.history.flatMap((entry) =>
      entry.kind === 'tool-result' && entry.tool === 'write' ? [entry] : []
    )
    for (const result of written) expect(result.text).toContain(PLAN_BLOCK)
    // With plan mode never turned off, no round may start at all.
    if (off < 0) expect(markers(facts, 'goal-round')).toEqual([])
    for (const round of markers(facts, 'goal-round')) expect(facts.history.indexOf(round)).toBeGreaterThan(off)
    if (crashed) return
    expect(written).toHaveLength(1)
    expect(markers(facts, 'goal-round')).toHaveLength(1)
  },
  roots: ({ thread }) => [thread]
})
