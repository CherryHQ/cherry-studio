import { describe, expect, it } from 'vitest'

import { offloadMarker, offloadName, offloadPlan, summaryDecision } from '../../../src/core/context/offload'
import { recallText } from '../../../src/core/context/recall'
import { assistant, callTo, compaction, marker, result, user } from '../history'

const big = 'x'.repeat(2999) + '\n' + 'y'.repeat(2000)

describe('offload (D31)', () => {
  // Catches offloading errors, nested calls or read results, or a threshold below the 3000-character floor.
  it('offloads only large successful top-level results', () => {
    expect(offloadPlan({ tool: 'bash', nested: false }, { text: big, isError: false }, 100)).toBe(offloadName(big))
    expect(
      offloadPlan({ tool: 'bash', nested: false }, { text: 'x'.repeat(2500), isError: false }, 100)
    ).toBeUndefined()
    expect(offloadPlan({ tool: 'bash', nested: false }, { text: big, isError: true }, 100)).toBeUndefined()
    expect(offloadPlan({ tool: 'bash', nested: true }, { text: big, isError: false }, 100)).toBeUndefined()
    expect(offloadPlan({ tool: 'read', nested: false }, { text: big, isError: false }, 100)).toBeUndefined()
  })

  // Catches a name that differs from today's Pi name for the same output (orphans pile up), or a marker that hides the
  // failure.
  it('names outputs by content and says where the rest is', () => {
    expect(offloadName(big)).toMatch(/^tool-output-[0-9a-f]{16}\.txt$/)
    expect(offloadName('abc')).toBe('tool-output-ba7816bf8f01cfea.txt')
    expect(offloadMarker(big, { path: 'out/f.txt' })).toContain('Full output saved to: out/f.txt')
    expect(offloadMarker(big, { error: 'disk full' })).toContain('could not be saved (disk full)')
  })

  // Catches an empty summary accepted, which would replace the folded history with nothing (D33).
  it('declines an empty summary', () => {
    expect(summaryDecision('  ')).toEqual({ decline: true })
    expect(summaryDecision('s')).toEqual({ summary: 's' })
  })
})

describe('recall (D32)', () => {
  // Catches recall losing what compaction folded, missing a person's words, or numbering records (which the model never
  // saw) as messages.
  it('numbers and searches the full lineage, folded entries included', () => {
    const history = [
      user('pick redis'),
      assistant('redis cache decision', { calls: [callTo('bash', { c: 1 })] }),
      compaction(),
      result('bash', { text: 'done' }),
      marker({ type: 'subagent-status' }, undefined, 'status')
    ]
    expect(recallText(history, { query: 'redis' })).toBe(
      '2 entries match "redis" (full text: expand:[N])\n#1 [assistant] redis cache decision bash({"c":1})\n#0 [user] pick redis'
    )
    expect(recallText(history, { range: [2, 3] })).toBe(
      '#2 [tool_result:bash] done\n#3 [custom:cherry.subagent-status] status'
    )
    expect(recallText(history, { expand: [5] })).toBe('No entries #5; this session has #0..#3.')
  })
})
