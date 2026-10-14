import { describe, expect, it, vi } from 'vitest'

import { compactHistory, planCompaction } from '../durableCompaction'
import { ContextPrompts } from '../prompts'
import type { ContextMessage } from '../types'

const sys = (content: string): ContextMessage => ({ role: 'system', content })
const user = (content: string): ContextMessage => ({ role: 'user', content })
const assistant = (content: string): ContextMessage => ({ role: 'assistant', content })
const assistantTool = (content: string, id: string): ContextMessage => ({
  role: 'assistant',
  content,
  tool_calls: [{ id, type: 'function', function: { name: 'f', arguments: '{}' } }]
})
const toolResult = (content: string, id: string): ContextMessage => ({
  role: 'tool',
  content,
  tool_call_id: id
})

// system, then 6 conversation turns:
//   u1 | a1 | u2 | (a2 + t2) | u3 | a3
const buildHistory = (): ContextMessage[] => [
  sys('sys'),
  user('u1'),
  assistant('a1'),
  user('u2'),
  assistantTool('a2', 'call-1'),
  toolResult('t2', 'call-1'),
  user('u3'),
  assistant('a3')
]

const contents = (msgs: ContextMessage[]): string[] => msgs.map((m) => m.content)

describe('planCompaction', () => {
  it('splits on turn boundaries, keeping the last N turns verbatim', () => {
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 2 })

    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2', 't2'])
    expect(contents(plan.toKeep)).toEqual(['u3', 'a3'])
  })

  it('never splits inside a tool turn (assistant + tool result stay together)', () => {
    // keepRecentTurns=3 keeps the (a2+t2) turn, u3, a3 — the tool pair must not
    // land half in toSummarize and half in toKeep.
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 3 })

    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1', 'u2'])
    expect(contents(plan.toKeep)).toEqual(['a2', 't2', 'u3', 'a3'])
  })

  it('preserves system messages verbatim and excludes them from the split', () => {
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 2 })

    expect(contents(plan.system)).toEqual(['sys'])
    expect(plan.toSummarize.some((m) => m.role === 'system')).toBe(false)
    expect(plan.toKeep.some((m) => m.role === 'system')).toBe(false)
  })

  it('summarizes everything when keepRecentTurns is 0', () => {
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 0 })

    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2', 't2', 'u3', 'a3'])
    expect(plan.toKeep).toEqual([])
  })

  it('keeps everything when keepRecentTurns exceeds the turn count', () => {
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 100 })

    expect(plan.toSummarize).toEqual([])
    expect(contents(plan.toKeep)).toEqual(['u1', 'a1', 'u2', 'a2', 't2', 'u3', 'a3'])
  })

  it('keeps everything when turn count exactly equals keepRecentTurns', () => {
    // 6 conversation turns; keepRecentTurns: 6 → equality is a no-op (toSummarize empty).
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 6 })

    expect(plan.toSummarize).toEqual([])
    expect(contents(plan.toKeep)).toEqual(['u1', 'a1', 'u2', 'a2', 't2', 'u3', 'a3'])
  })

  it('returns empty slices for an empty history', () => {
    const plan = planCompaction([], { keepRecentTurns: 2 })

    expect(plan).toEqual({ system: [], toSummarize: [], toKeep: [] })
  })

  it('handles a history with no system message', () => {
    const history = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
    const plan = planCompaction(history, { keepRecentTurns: 2 })

    expect(plan.system).toEqual([])
    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1'])
    expect(contents(plan.toKeep)).toEqual(['u2', 'a2'])
  })

  it('clamps a negative keepRecentTurns to 0 (summarizes everything)', () => {
    const plan = planCompaction(buildHistory(), { keepRecentTurns: -1 })

    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2', 't2', 'u3', 'a3'])
    expect(plan.toKeep).toEqual([])
  })

  it('floors a fractional keepRecentTurns', () => {
    // 2.5 floors to 2 → identical to keepRecentTurns: 2.
    const plan = planCompaction(buildHistory(), { keepRecentTurns: 2.5 })

    expect(contents(plan.toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2', 't2'])
    expect(contents(plan.toKeep)).toEqual(['u3', 'a3'])
  })
})

describe('compactHistory', () => {
  it('summarizes the old slice into [...system, <summary>, ...toKeep]', async () => {
    const history = buildHistory()
    const result = await compactHistory(history, async () => 'SUMMARY-XYZ', {
      keepRecentTurns: 2
    })

    expect(result).toHaveLength(1 /* system */ + 1 /* summary */ + 2 /* kept */)
    expect(result[0]).toEqual(sys('sys'))

    const summaryMsg = result[1]
    expect(summaryMsg.role).toBe('user')
    expect(summaryMsg.content).toBe(ContextPrompts.getCompactSummaryWrapper('SUMMARY-XYZ'))
    expect(summaryMsg.content).toContain('SUMMARY-XYZ')

    expect(contents(result.slice(2))).toEqual(['u3', 'a3'])
  })

  it('returns the same history reference when nothing is old enough to compact', async () => {
    const history = buildHistory()
    const result = await compactHistory(history, async () => 'unused', {
      keepRecentTurns: 100
    })

    expect(result).toBe(history)
  })

  it('returns the same history reference when the summarizer yields no text', async () => {
    const history = buildHistory()
    const result = await compactHistory(history, async () => '', { keepRecentTurns: 2 })

    expect(result).toBe(history)
  })

  it('returns the same empty reference and never calls compress on an empty history', async () => {
    const history: ContextMessage[] = []
    const compress = vi.fn(async () => 'unused')
    const result = await compactHistory(history, compress, { keepRecentTurns: 2 })

    expect(result).toBe(history)
    expect(compress).not.toHaveBeenCalled()
  })

  it('puts the summary first when there is no system message', async () => {
    const history = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
    const result = await compactHistory(history, async () => 'SUM', { keepRecentTurns: 1 })

    expect(result[0].role).toBe('user')
    expect(result[0].content).toBe(ContextPrompts.getCompactSummaryWrapper('SUM'))
    // keepRecentTurns: 1 keeps only the last turn.
    expect(contents(result.slice(1))).toEqual(['a2'])
  })
})
