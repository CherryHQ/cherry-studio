import { expect } from 'vitest'

import { callTool, latch, reply } from '../../../src/contract/fixtures'
import { ENTRY_KINDS, type ConversationFacts } from '../../../src/core/facts'
import { admittedRounds, currentGoal } from '../../../src/core/goal/goalHistory'
import type { BoundPorts } from '../../../src/ports/harness'
import { markers, records, type World, wrapJob } from '../world'
import { describeScenario } from './scenario'

const SETTINGS = { goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 } }
const command = (w: World, thread: ConversationFacts['thread'], text: string, key: string) =>
  w.enter(thread, (entries, ports) => entries.goalCommand(ports, thread, text, key))
const rounds = (facts: ConversationFacts) => markers(facts, 'goal-round')

// Fixture 7.
describeScenario({
  name: 'a conversation reopens while an armed goal round runs',
  catches: 'a reopened conversation going back to work on its own (AC11)',
  options: { settings: SETTINGS },
  async setup(w, hold) {
    const thread = await w.fake.createThread()
    w.fake.script(thread, [callTool('hold', { id: 'round' }), reply('kept working after the restart')])
    await command(w, thread, 'ship it', 'cmd-1')
    await hold.started('round')
    return { thread }
  },
  // The held call returns once the restart is over, so a round left running would reach its next reply.
  async drive(w, _prepared, hold) {
    await w.fake.restart()
    hold.release('round')
    await w.fake.settle()
  },
  afterRestart: (_prepared, hold) => hold.release('round'),
  async expect(w, { thread }) {
    const facts = await w.read(thread)
    const goal = currentGoal(facts.history)
    expect(goal).toMatchObject({ phase: 'active', armed: false })
    expect(goal?.lastStop).toBeUndefined()
    expect(rounds(facts)).toHaveLength(1)
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    expect(records(facts, 'turn-stop').map(({ value }) => value.cause)).toEqual(['reopen'])
    expect(facts.history.some((entry) => entry.kind === 'assistant' && entry.text.includes('after the restart'))).toBe(
      false
    )
  },
  roots: ({ thread }) => [thread]
})

// Fixture 8. `crashNext` cuts the process right after the driver's first round start, before its admission.
let crashNext: (() => void) | undefined
const crashAfterStart = (ports: BoundPorts): BoundPorts => ({
  ...ports,
  turns: {
    ...ports.turns,
    start: async (thread, input, key) => {
      const started = await ports.turns.start(thread, input, key)
      const crash = input.kind === ENTRY_KINDS.goalRound ? crashNext : undefined
      if (crash) crashNext = undefined
      crash?.()
      return started
    }
  }
})
describeScenario({
  name: 'a goal resumed after a reopen that cut a round before its admission',
  catches: 'the resumed round deduplicated into the cut one (armSeq left out of the round key)',
  options: { settings: SETTINGS, wrap: wrapJob('idle-driver', crashAfterStart) },
  async setup(w) {
    const thread = await w.fake.createThread()
    w.fake.script(thread, [reply('the cut round ran'), reply('the resumed round ran'), reply('never')])
    const armed = latch()
    crashNext = () => {
      w.fake.crashAt(1)
      armed.release()
    }
    void command(w, thread, 'ship it', 'cmd-1')
    await armed.promise
    await w.fake.whenCrashed()
    await w.fake.restart()
    await w.fake.settle()
    return { thread }
  },
  async drive(w, { thread }) {
    await command(w, thread, 'resume', 'cmd-2')
    await w.fake.settle()
  },
  async expect(w, { thread }, crashed) {
    const facts = await w.read(thread)
    const [cut, resumed] = rounds(facts)
    expect(admittedRounds(facts.history).has(cut.marker.round.id)).toBe(false)
    if (crashed && !resumed) return
    expect(resumed.marker.round.id).not.toBe(cut.marker.round.id)
    if (crashed) return
    expect(admittedRounds(facts.history).has(resumed.marker.round.id)).toBe(true)
    const after = facts.history.slice(facts.history.indexOf(resumed))
    expect(after.some((entry) => entry.kind === 'assistant' && entry.text === 'the resumed round ran')).toBe(true)
    expect(currentGoal(facts.history)?.lastStop?.code).toBe('round_limit')
  },
  roots: ({ thread }) => [thread]
})
