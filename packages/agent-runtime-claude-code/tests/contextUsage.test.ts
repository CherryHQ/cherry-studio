import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { normalizeContextUsage } from '../src/contextUsage'

const native: SDKControlGetContextUsageResponse = {
  model: 'gateway-model',
  totalTokens: 34087,
  maxTokens: 854560,
  rawMaxTokens: 854560,
  percentage: 4,
  autoCompactThreshold: 821560,
  isAutoCompactEnabled: true,
  categories: [
    { id: 'messages', name: 'Renamed message label', tokens: 34087, kind: 'used', color: '' },
    { id: 'mcp_tools_deferred', name: 'Renamed deferred label', tokens: 50000, kind: 'deferred', color: '' },
    { id: 'autocompact_buffer', name: 'Buffer', tokens: 33000, kind: 'buffer', color: '' }
  ],
  gridRows: [],
  memoryFiles: [],
  agents: [],
  mcpTools: [{ name: 'search', serverName: 'docs', tokens: 50000, isLoaded: false }],
  apiUsage: null
}

it('keeps the full gateway window separate from the native compaction threshold and unknown free capacity', () => {
  const usage = normalizeContextUsage(native, 1000000)
  expect(usage).toMatchObject({
    contextWindow: 1000000,
    compactionThreshold: 821560,
    used: { tokens: 34087, precision: 'estimated' },
    reserved: { tokens: 33000 }
  })
  expect(usage.free).toBeUndefined()
  expect(usage.breakdown).toMatchObject({
    coverage: 'complete',
    categories: [
      { key: 'messages', occupancy: 'included' },
      { key: 'mcp-tools', occupancy: 'deferred' }
    ]
  })
  expect(usage.resources).toMatchObject([{ category: 'mcp-tools', state: 'deferred', source: 'docs' }])
})

it('does not rescale partial categories to a total or add resource tokens twice', () => {
  const usage = normalizeContextUsage({ ...native, totalTokens: 40000, rawMaxTokens: 1000000 }, 1000000)
  expect(usage.used?.tokens).toBe(40000)
  expect(usage.breakdown?.coverage).toBe('partial')
  expect(usage.breakdown?.categories[0].tokens).toBe(34087)
  expect(usage.free?.tokens).toBe(927000)
})

it('does not invent a zero reserve or sum possibly overlapping buffers', () => {
  for (const categories of [
    native.categories.slice(0, 2),
    [...native.categories, { name: 'Another buffer', tokens: 5000, kind: 'buffer' as const, color: '' }]
  ]) {
    const usage = normalizeContextUsage({ ...native, rawMaxTokens: 1000000, categories }, 1000000)
    expect(usage.reserved).toBeUndefined()
    expect(usage.free).toBeUndefined()
  }
})

it('falls back from unknown category IDs and versions allocation changes', () => {
  const usage = normalizeContextUsage(
    {
      ...native,
      categories: [
        {
          id: 'future_messages' as SDKControlGetContextUsageResponse['categories'][number]['id'],
          name: 'Messages',
          kind: 'used',
          tokens: 34087,
          color: ''
        }
      ]
    },
    1000000
  )
  expect(usage.breakdown?.categories[0].key).toBe('messages')
  const disabled = normalizeContextUsage({ ...native, isAutoCompactEnabled: false }, 1000000)
  expect(disabled.compactionThreshold).toBeUndefined()
  expect(disabled.revision).not.toBe(normalizeContextUsage(native, 1000000).revision)
})
