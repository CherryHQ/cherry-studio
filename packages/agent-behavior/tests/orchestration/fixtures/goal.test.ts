import { expect } from 'vitest'

import { callTool, reply, toolBase, toolResults } from '../../../src/contract/fixtures'
import { deniedReason, REPEATED_CALL } from '../../../src/core/approval/approval'
import type { ConversationFacts, GoalStopCode, ToolCallFact } from '../../../src/core/facts'
import { currentGoal } from '../../../src/core/goal/goalHistory'
import type { CallRef } from '../../../src/core/hostFacts'
import type { HarnessPorts } from '../../../src/ports/harness'
import { ALLOWED, markers, type World } from '../world'
import { describeScenario } from './scenario'

const SETTINGS = { goalDefaults: { maxGoalRounds: 8, maxGoalRoundsCeiling: 50, blockedAfter: 3 } }
const rounds = (facts: ConversationFacts) => markers(facts, 'goal-round').map(({ marker }) => marker.round.kind)
const register = (ports: HarnessPorts) => {
  for (const name of ['echo', 'danger'])
    ports.tools.register({ ...toolBase(name), run: async () => ({ text: 'ran', isError: false }) })
}
const command = (w: World, thread: ConversationFacts['thread']) =>
  w.enter(thread, (entries, ports) => entries.goalCommand(ports, thread, 'ship it', 'cmd-1'))
/**
 * After a crash a reopen disarms the goal (G-f), so it may end armed-off and unstopped, or not exist when the
 * command itself was cut; when it stopped, it stopped for the scenario's reason.
 */
function stoppedFor(facts: ConversationFacts, code: GoalStopCode, crashed: boolean): void {
  const goal = currentGoal(facts.history)
  if (!crashed) {
    expect(goal?.lastStop?.code).toBe(code)
    return
  }
  if (goal?.lastStop) expect(goal.lastStop.code).toBe(code)
  else if (goal) expect(goal.armed).toBe(false)
}

// Fixture 4.
describeScenario({
  name: 'a goal makes no progress for three rounds',
  catches: 'a wrong stop code or a miscounted streak',
  options: { settings: SETTINGS },
  async setup(w) {
    const thread = await w.fake.createThread()
    w.fake.script(
      thread,
      Array.from({ length: 6 }, () => reply('still working on it'))
    )
    return { thread }
  },
  async drive(w, { thread }) {
    await command(w, thread)
    await w.fake.settle()
  },
  async expect(w, { thread }, crashed) {
    const facts = await w.read(thread)
    stoppedFor(facts, 'no_progress', crashed)
    // Round 1 differs from nothing before it; rounds 2 and 3 repeat it; round 4 is the hint; then the goal stops.
    const kinds = ['work', 'work', 'work', 'hint']
    if (crashed) expect(kinds.slice(0, rounds(facts).length)).toEqual(rounds(facts))
    else expect(rounds(facts)).toEqual(kinds)
  },
  roots: ({ thread }) => [thread]
})

// Fixture 5.
describeScenario({
  name: 'a goal round repeats the same call five times',
  catches: 'a call blocked but the goal not stopped (R4)',
  options: { settings: SETTINGS, extra: register },
  async setup(w) {
    const thread = await w.fake.createThread()
    const echo = callTool('echo', { same: true })
    w.fake.script(thread, [echo, echo, echo, echo, echo, reply('stuck'), reply('never')])
    return { thread }
  },
  async drive(w, { thread }) {
    await command(w, thread)
    await w.fake.settle()
  },
  async expect(w, { thread }, crashed) {
    const facts = await w.read(thread)
    stoppedFor(facts, 'no_progress', crashed)
    if (crashed) return
    expect(toolResults(facts).map(({ text }) => text.includes(REPEATED_CALL))).toEqual([false, false, true, true, true])
    expect(currentGoal(facts.history)?.lastStop?.message).toBe('the same echo call was repeated 5 times')
    expect(rounds(facts)).toHaveLength(1)
  },
  roots: ({ thread }) => [thread]
})

// Fixture 6.
const asking = (_call: CallRef, tool: ToolCallFact) =>
  tool.name === 'danger' ? { ...ALLOWED, autoApproved: false, approvalRequired: true } : ALLOWED
describeScenario({
  name: 'a person denies a call while a goal runs',
  catches: 'a denial that does not stop the goal (D9)',
  options: { settings: SETTINGS, extra: register, host: { approvalFacts: asking } },
  async setup(w) {
    const thread = await w.fake.createThread()
    w.fake.script(thread, [callTool('danger', {}), reply('it was denied'), reply('never')])
    w.host.answerApproval({ kind: 'denied' })
    return { thread }
  },
  async drive(w, { thread }) {
    await command(w, thread)
    await w.fake.settle()
  },
  async expect(w, { thread }, crashed) {
    const facts = await w.read(thread)
    stoppedFor(facts, 'approval_denied', crashed)
    // A crash while the person was being asked asks again (harness-limited row 9); never more often.
    expect(w.host.asked.approvals).toBeLessThanOrEqual(crashed ? 2 : 1)
    if (crashed) return
    expect(toolResults(facts)[0]).toMatchObject({ isError: true, text: expect.stringContaining(deniedReason()) })
    expect(rounds(facts)).toHaveLength(1)
  },
  roots: ({ thread }) => [thread]
})
