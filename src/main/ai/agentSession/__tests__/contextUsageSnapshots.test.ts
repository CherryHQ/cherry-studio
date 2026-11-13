import { describe, expect, it } from 'vitest'

import type { AgentSessionContextUsageSnapshot } from '@shared/ai/agentSessionContextUsage'

import { isContextUsageSnapshot, mergeContextUsageSnapshot, pruneContextUsageSnapshots } from '../contextUsageSnapshots'

const record = (measuredAt = '2026-11-12T00:00:00.000Z'): AgentSessionContextUsageSnapshot => ({
  version: 1,
  modelId: 'provider::model',
  agentUpdatedAt: measuredAt,
  contextId: 'context',
  backendId: 'backend',
  nativeThreadId: 'native',
  headMessageId: 'head',
  headUpdatedAt: measuredAt,
  measuredAt,
  usage: {
    model: 'native-model',
    revision: 'r1',
    contextWindow: 100,
    used: { tokens: 0, precision: 'reported' },
    basis: 'current-context'
  }
})

describe('context usage snapshot policy', () => {
  it('keeps a genuine zero but rejects missing, negative and non-finite occupancy and windows', () => {
    expect(isContextUsageSnapshot(record())).toBe(true)
    for (const tokens of [-1, NaN, Infinity, undefined]) {
      const value = record()
      expect(
        isContextUsageSnapshot({ ...value, usage: { ...value.usage, used: { tokens, precision: 'reported' } } })
      ).toBe(false)
    }
    for (const contextWindow of [0, -1, NaN, Infinity])
      expect(isContextUsageSnapshot({ ...record(), usage: { ...record().usage, contextWindow } })).toBe(false)
    expect(isContextUsageSnapshot({ ...record(), usage: { ...record().usage, used: undefined } })).toBe(false)
  })

  it('removes malformed and missing-session records on save', () => {
    const records = { valid: record(), orphan: record(), malformed: { version: 2 } } as unknown as Record<
      string,
      AgentSessionContextUsageSnapshot
    >
    expect(pruneContextUsageSnapshots(records, (id) => id !== 'orphan')).toEqual({ valid: record() })
  })

  it('deduplicates identical readings and identity without advancing measuredAt', () => {
    const original = record()
    const repeated = { ...original, measuredAt: '2026-11-12T01:00:00.000Z' }
    expect(mergeContextUsageSnapshot({ session: original }, 'session', repeated, () => true).session).toEqual(original)
    repeated.usage = { ...original.usage, revision: 'r2' }
    expect(mergeContextUsageSnapshot({ session: original }, 'session', repeated, () => true).session).toEqual(repeated)
  })

  it('evicts oldest first with session ID as the tie-breaker at the count bound', () => {
    const records = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i).padStart(3, '0'), record()]))
    const kept = pruneContextUsageSnapshots(records, () => true)
    expect(Object.keys(kept)).toHaveLength(100)
    expect(kept['000']).toBeUndefined()
    expect(kept['100']).toEqual(record())
    records['100'] = record('2026-11-11T00:00:00.000Z')
    expect(pruneContextUsageSnapshots(records, () => true)['100']).toBeUndefined()
  })

  it('evicts whole readings at the independently serialized UTF-8 map byte bound', () => {
    const large = record()
    large.usage = { ...large.usage, resources: [{ id: 'r', category: 'skills', name: '測'.repeat(2990) }] }
    const records = Object.fromEntries(
      Array.from({ length: 27 }, (_, i) => [String(i).padStart(3, '0'), structuredClone(large)])
    )
    const nestedBytes = (map: typeof records) => {
      const serialized = JSON.stringify({ snapshots: map }, null, 2)
      return Buffer.byteLength(serialized.slice(serialized.indexOf('{', 1), serialized.lastIndexOf('}') - 1))
    }
    const remaining = 256 * 1024 - nestedBytes(records)
    expect(remaining).toBeGreaterThan(0)
    records['026'].usage.resources![0].name += 'x'.repeat(remaining)
    expect(nestedBytes(records)).toBe(256 * 1024)
    expect(pruneContextUsageSnapshots(records, () => true)).toEqual(records)
    records['026'].usage.resources![0].name += 'x'
    const kept = pruneContextUsageSnapshots(records, () => true)
    expect(nestedBytes(kept)).toBeLessThanOrEqual(256 * 1024)
    expect(Object.keys(kept)).toHaveLength(26)
    expect(kept['000']).toBeUndefined()
    expect(kept['026']).toEqual(records['026'])
  })

  it('drops oversized replacements without truncating the live reading', () => {
    const large = record()
    large.usage = { ...large.usage, resources: [{ id: 'r', category: 'skills', name: 'x'.repeat(17000) }] }
    expect(mergeContextUsageSnapshot({ session: record() }, 'session', large, () => true)).toEqual({})
    expect(large.usage.resources?.[0].name).toHaveLength(17000)
  })
})
