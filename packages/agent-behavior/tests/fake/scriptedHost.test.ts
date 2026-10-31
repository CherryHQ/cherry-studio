import { describe, expect, it } from 'vitest'

import type { ThreadId } from '@cherrystudio/agent-runtime'

import { callKeyOf } from '../../src/core/facts'
import type { HostSettingsSnapshot } from '../../src/core/hostFacts'
import { createScriptedHost } from '../../src/fake/scriptedHost'

const settings: HostSettingsSnapshot = {
  goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
  autonomy: 'auto',
  permissionMode: 'default',
  attendance: 'stream',
  maxBackground: 2,
  offloadThreshold: 4000
}
const thread = 't' as ThreadId
const call = { thread, key: callKeyOf('call-1') }
const tool = { callId: 'call-1', callKey: call.key, name: 'bash', args: {} }

describe('scripted host', () => {
  // Catches a host that answers instantly, which would make Stage B's awaiting-approval rules (D23, slot counting) untestable.
  it('keeps an unanswered approval pending and visible until an answer is queued', async () => {
    const host = createScriptedHost({ settings })
    const answer = host.approvals.ask({ call, tool, presentation: 'stream' }, new AbortController().signal)
    expect(await host.approvals.outcomes(thread, [])).toEqual([{ call, state: 'pending' }])
    host.answerApproval({ kind: 'denied', feedback: 'no' })
    expect(await answer).toEqual({ kind: 'denied', feedback: 'no' })
    expect(await host.approvals.outcomes(thread, [call])).toEqual([{ call, state: 'denied', feedback: 'no' }])
    expect(host.asked.approvals).toBe(1)
  })

  // Catches answers consumed out of order, which would hand one call another call's answer.
  it('uses queued answers first in, first out', async () => {
    const host = createScriptedHost({ settings })
    host.answerQuestion({ status: 'declined' })
    host.answerQuestion({ status: 'unavailable' })
    const signal = new AbortController().signal
    expect(await host.questions.ask({ call, questions: [] }, signal)).toEqual({ status: 'declined' })
    expect(await host.questions.ask({ call, questions: [] }, signal)).toEqual({ status: 'unavailable' })
  })

  // Catches an aborted ask that lingers as pending and keeps a goal waiting on a person who was never asked.
  it('rejects an aborted ask and drops its pending outcome', async () => {
    const host = createScriptedHost({ settings })
    const controller = new AbortController()
    const answer = host.approvals.ask({ call, tool, presentation: 'stream' }, controller.signal)
    controller.abort(new Error('turn stopped'))
    await expect(answer).rejects.toThrow('turn stopped')
    expect(await host.approvals.outcomes(thread, [])).toEqual([])
  })

  // Catches a summarizer that hangs instead of failing, which would hide D33's "failure cancels the compaction" path.
  it('rejects a summary request when none is queued', async () => {
    const host = createScriptedHost({ settings })
    await expect(
      host.summarizer.summarize({ reason: 'manual', thread, messages: [] }, new AbortController().signal)
    ).rejects.toThrow()
  })

  // Catches a summarizer that always rejects or serves summaries out of order, which would make every compaction fail.
  it('serves queued summaries first in, first out', async () => {
    const host = createScriptedHost({ settings })
    host.giveSummary('first')
    host.giveSummary('second')
    const signal = new AbortController().signal
    const request = { reason: 'threshold', thread, messages: [] } as const
    expect(await host.summarizer.summarize(request, signal)).toBe('first')
    expect(await host.summarizer.summarize(request, signal)).toBe('second')
    expect(host.asked.summaries).toBe(2)
  })

  // Catches an aborted ask that stays queued and swallows the next answer meant for a live ask.
  it('gives a later answer to a live ask, not to an aborted one', async () => {
    const host = createScriptedHost({ settings })
    const controller = new AbortController()
    const aborted = host.questions.ask({ call, questions: [] }, controller.signal)
    controller.abort(new Error('turn stopped'))
    await expect(aborted).rejects.toThrow('turn stopped')
    const live = host.questions.ask({ call, questions: [] }, new AbortController().signal)
    host.answerQuestion({ status: 'declined' })
    expect(await live).toEqual({ status: 'declined' })
  })

  // Catches outcomes leaking across conversations or ignoring the requested calls, which would hand a goal another thread's approval state.
  it('reports outcomes only for the asked thread and calls', async () => {
    const host = createScriptedHost({ settings })
    const other = { thread, key: callKeyOf('call-2') }
    const elsewhere = { thread: 'u' as ThreadId, key: call.key }
    const signal = new AbortController().signal
    void host.approvals.ask({ call, tool, presentation: 'stream' }, signal)
    void host.approvals.ask({ call: other, tool, presentation: 'stream' }, signal)
    void host.approvals.ask({ call: elsewhere, tool, presentation: 'stream' }, signal)
    expect(await host.approvals.outcomes(thread, [other])).toEqual([{ call: other, state: 'pending' }])
    expect(await host.approvals.outcomes(thread, [])).toEqual([
      { call, state: 'pending' },
      { call: other, state: 'pending' }
    ])
  })

  // Catches content-addressed saves that fail or move on a rerun, which design §6.3 P5 relies on being harmless.
  it('returns the same path when a name is saved again', async () => {
    const host = createScriptedHost({ settings })
    const file = { name: 'out-abc.txt', content: 'x', key: call.key, tool: 'bash' }
    expect(await host.outputStore.save(file)).toBe(await host.outputStore.save(file))
  })

  // Catches empty model keys, which would record a spawn's origin with no model (B-G3), or a model a test cannot set.
  it('names non-empty model keys, or the model it was given', async () => {
    const current = await createScriptedHost({ settings }).models.current(thread)
    expect(current.parentModelKey).not.toBe('')
    expect(current.defaultChildModelKey).not.toBe('')
    const given = { parentModelKey: 'anthropic/opus', defaultChildModelKey: 'anthropic/sonnet' }
    const host = createScriptedHost({ settings, modelKeys: given, supportsTools: false })
    expect(await host.models.current(thread)).toEqual({ ...given, supportsTools: false })
  })

  // Catches settings read once at construction, which would hide Stage B rules that must see a mid-goal change.
  it('serves the latest settings', () => {
    const host = createScriptedHost({ settings })
    host.setSettings({ permissionMode: 'plan', autonomy: 'confirm-each-round' })
    expect(host.settings.permissionMode(thread)).toBe('plan')
    expect(host.settings.autonomy()).toBe('confirm-each-round')
    expect(host.settings.maxBackground()).toBe(2)
  })
})
