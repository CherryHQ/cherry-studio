import { describe, expect, it, vi } from 'vitest'

import { callTool, reply, toolResults } from '../../src/contract/fixtures'
import { currentGoal } from '../../src/core/goal/goalHistory'
import { COMPLETE_INSTRUCTION } from '../../src/core/goal/goalState'
import { unverifiedText } from '../../src/core/goal/goalTools'
import { world, wrapTool } from './world'

const QUESTION = {
  questions: [
    {
      question: 'Which database?',
      header: 'Database',
      options: [
        { label: 'Postgres', description: 'Relational' },
        { label: 'Redis', description: 'In memory' }
      ]
    }
  ]
}
// `/goal` with request key cmd-1 names goal:cmd:cmd-1; admitting round 1 bumps it to revision 2.
const COMPLETE = { goal_id: 'goal:cmd:cmd-1', revision: 2, action: 'complete', evidence: 'the tests pass' }

describe('goal tools', () => {
  // Catches a completion the host verifier never judged, or a verifier asked again for the same call (D6, DP G6).
  it('update_goal completes a goal once the verifier says it is met', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('update_goal', COMPLETE), reply('summary for the person')])
    w.host.giveVerdict({ verdict: 'met', reason: 'all deliverables checked' })
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    const facts = await w.read(t)
    expect(currentGoal(facts.history)?.phase).toBe('complete')
    expect(toolResults(await w.read(t))[0].text).toContain(COMPLETE_INSTRUCTION)
    expect(w.host.asked.verdicts).toBe(1)
  })

  // Catches a completion stamped with the time read before the verifier wait instead of when it was decided.
  it('update_goal stamps the completion with the time after the verifier answered', async () => {
    let now = 1_000
    const w = world({
      wrap: wrapTool('update_goal', (run) => (call, ports) => run(call, { ...ports, clock: { now: () => now } }))
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('update_goal', COMPLETE), reply('summary for the person')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await vi.waitFor(() => expect(w.host.asked.verdicts).toBe(1))
    now = 9_000
    w.host.giveVerdict({ verdict: 'met', reason: 'all deliverables checked' })
    await w.fake.settle()
    expect(currentGoal((await w.read(t)).history)?.lastStop).toMatchObject({ code: 'complete', at: 9_000 })
  })

  // Catches a verifier failure that completes the goal anyway or surfaces as a thrown tool error (Stage B plan choice 12).
  it('update_goal writes nothing when the verifier fails', async () => {
    const w = world({
      patchHost: (host) => ({ ...host, verifier: { verify: () => Promise.reject(new Error('verifier offline')) } })
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('update_goal', COMPLETE), reply('keep going'), reply('round 2')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result).toMatchObject({ text: unverifiedText('verifier offline'), isError: true })
    expect(currentGoal((await w.read(t)).history)?.lastStop?.code).not.toBe('complete')
  })
})

describe('interaction and recall tools', () => {
  // Catches questions asked without the person's answer reaching the model, or the answer not kept for a rerun (DP I1).
  it('AskUserQuestion asks once and returns the answer', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('AskUserQuestion', QUESTION), reply('thanks')])
    w.host.answerQuestion({ status: 'answered', answers: { 'Which database?': 'Redis' } })
    await w.fake.sendUser(t, 'help me choose')
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result.text).toContain('"Which database?" = "Redis"')
    expect(result.details).toMatchObject({ outcome: 'answered' })
    expect(w.host.asked.questions).toBe(1)
    expect(JSON.stringify(w.fake.persistentLog())).toContain(`cherry.ask:${result.callKey}`)
  })

  // Catches a stopped turn's pending question surfacing as a tool error instead of the `aborted` outcome the card shows.
  it('AskUserQuestion answers aborted when the turn stops while it waits', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('AskUserQuestion', QUESTION), reply('never')])
    await w.fake.sendUser(t, 'help me choose')
    await vi.waitFor(() => expect(w.host.asked.questions).toBe(1))
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result.details).toMatchObject({ outcome: 'aborted' })
  })

  // Catches recall over the model's post-compaction context instead of the full history (agent-runtime-pi README context).
  it('vcc_recall finds what a compaction folded away', async () => {
    const w = world()
    const t = await w.fake.createThread()
    w.fake.script(t, [reply('noted'), callTool('vcc_recall', { query: 'redis' }), reply('found it')])
    await w.fake.sendUser(t, 'we picked redis for the cache')
    await w.fake.settle()
    w.host.giveSummary('the person chose a cache')
    await w.fake.compact(t)
    await w.fake.sendUser(t, 'what did we pick?')
    await w.fake.settle()
    const history = (await w.read(t)).history
    expect(history.some((entry) => entry.kind === 'compaction')).toBe(true)
    expect(toolResults(await w.read(t)).at(-1)?.text).toContain('we picked redis for the cache')
  })
})
