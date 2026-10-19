import { describe, expect, it, vi } from 'vitest'

import { callTool, reply, toolBase, toolResults } from '../../src/contract/fixtures'
import { ASK_WITHDRAWN, deniedReason, REPEATED_CALL } from '../../src/core/approval/approval'
import { offloadName } from '../../src/core/context/offload'
import type { ToolCallFact } from '../../src/core/facts'
import type { ApprovalHostFacts, CallRef } from '../../src/core/hostFacts'
import type { HarnessPorts, ToolDefinition } from '../../src/ports/harness'
import type { ApprovalRequest } from '../../src/ports/host'
import { ALLOWED, world } from './world'

const LONG = 'output line\n'.repeat(500)
const tool = (name: string, text = 'ran'): ToolDefinition => ({
  ...toolBase(name),
  run: async () => ({ text, isError: false })
})
const register =
  (...defs: ToolDefinition[]) =>
  (ports: HarnessPorts): void => {
    for (const def of defs) ports.tools.register(def)
  }
/** `danger` always asks a person; every other call runs. */
const asking = (_call: CallRef, tool: ToolCallFact): ApprovalHostFacts =>
  tool.name === 'danger' ? { ...ALLOWED, autoApproved: false, approvalRequired: true } : ALLOWED

describe('tool gate', () => {
  // Catches the ask decision's presentation never reaching the host (Stage B Task 7 contract to-do), or a second ask for
  // a call already answered (H6: the answer is memoized under the call key).
  it('asks once per call, with the presentation the attendance chose', async () => {
    const requests: ApprovalRequest[] = []
    const w = world({
      extra: register(tool('danger')),
      settings: { attendance: 'message' },
      host: { approvalFacts: asking },
      patchHost: (host) => ({
        ...host,
        approvals: {
          ...host.approvals,
          ask: (request, signal) => (requests.push(request), host.approvals.ask(request, signal))
        }
      })
    })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('danger', {}), reply('done')])
    w.host.answerApproval({ kind: 'granted' })
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result).toMatchObject({ text: 'ran', isError: false })
    expect(requests.map(({ presentation }) => presentation)).toEqual(['message'])
    expect(JSON.stringify(w.fake.persistentLog())).toContain(`cherry.approval:${result.callKey}`)
  })

  // Catches a denial that runs the call anyway or loses the person's words (D35).
  it("blocks a denied call with the person's feedback", async () => {
    const w = world({ extra: register(tool('danger')), host: { approvalFacts: asking } })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('danger', {}), reply('ok')])
    w.host.answerApproval({ kind: 'denied', feedback: 'not on main' })
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining(deniedReason('not on main')) })
  })

  // Catches a pending approval the turn's stop cannot withdraw (G-C1): the stop would wait for the person's answer; or
  // a withdrawn ask remembered as answered, so a rerun of the call would never ask.
  it('withdraws a pending approval when the turn stops', async () => {
    const w = world({ extra: register(tool('danger')), host: { approvalFacts: asking } })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('danger', {}), reply('never')])
    await w.fake.sendUser(t, 'go')
    await vi.waitFor(() => expect(w.host.asked.approvals).toBe(1))
    await w.enter(t, (entries, ports) => entries.userStop(ports, t, 'stop-1'))
    await w.fake.settle()
    const [result] = toolResults(await w.read(t))
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining(ASK_WITHDRAWN) })
    expect(await w.host.approvals.outcomes(t, [])).toEqual([])
    expect(JSON.stringify(w.fake.persistentLog())).not.toContain(`cherry.approval:${result.callKey}`)
  })

  // Catches the gate ignoring the goal round's call window, so a stuck model repeats a call forever (R4, block half).
  it('blocks the third identical call in a goal round', async () => {
    const w = world({
      extra: register(tool('echo')),
      settings: { goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 } }
    })
    const t = await w.fake.createThread()
    const echo = callTool('echo', { n: 1 })
    w.fake.script(t, [echo, echo, echo, reply('stuck')])
    await w.enter(t, (entries, ports) => entries.goalCommand(ports, t, 'ship it', 'cmd-1'))
    await w.fake.settle()
    expect(toolResults(await w.read(t)).map(({ text }) => text.includes(REPEATED_CALL))).toEqual([false, false, true])
  })

  // Catches an offload that misses a long result or swallows a read of an offloaded file (D31).
  it('saves a long result behind a marker and leaves read results whole', async () => {
    const w = world({ extra: register(tool('bash', LONG), tool('read', LONG)), settings: { offloadThreshold: 1000 } })
    const t = await w.fake.createThread()
    w.fake.script(t, [callTool('bash', {}), callTool('read', { path: 'x' }), reply('done')])
    await w.fake.sendUser(t, 'go')
    await w.fake.settle()
    const [bash, read] = toolResults(await w.read(t))
    expect(bash.text).toContain('<persisted-output>')
    expect(read.text).toBe(LONG)
    expect(w.host.saved.map(({ name, key }) => [name, key])).toEqual([[offloadName(LONG), bash.callKey]])
  })
})
