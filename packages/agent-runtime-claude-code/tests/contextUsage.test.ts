import { randomUUID } from 'node:crypto'

import type { SDKControlGetContextUsageResponse, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { normalizeContextUsage } from '../src/contextUsage'
import { observe } from './nativeFixture'
import { wireFixture } from './wireFixture'

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
  expect(disabled.revision).not.toBe(normalizeContextUsage(native, 1000000).revision)
})

async function partial(test: Awaited<ReturnType<typeof wireFixture>>, event: SDKPartialAssistantMessage['event']) {
  const uuid = randomUUID()
  test.send({ type: 'stream_event', uuid, session_id: test.sessionId, parent_tool_use_id: null, event })
  await test.view.event((message) => 'uuid' in message && message.uuid === uuid)
}

async function start(test: Awaited<ReturnType<typeof wireFixture>>, model: string) {
  await partial(test, { type: 'message_start', message: { ...test.assistant('').message, model } })
}

it.each(['unmapped-model', 'gateway-model[1m]'])(
  'keeps the active response model through output deltas: %s',
  async (model) => {
    const test = await wireFixture({
      model: 'gateway-model',
      contextWindow: { model: 'gateway-model', tokens: 1000000 }
    })
    try {
      await start(test, 'gateway-model')
      expect(test.view.snapshot.contextUsage).toMatchObject({ status: 'confirmed', value: { model: 'gateway-model' } })
      await start(test, model)
      await partial(test, {
        type: 'message_delta',
        context_management: null,
        delta: { stop_reason: null, stop_sequence: null, container: null, stop_details: null },
        usage: {
          output_tokens: 2,
          input_tokens: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          iterations: null,
          server_tool_use: null
        }
      })
      expect(test.view.snapshot.contextUsage).toMatchObject(
        model === 'unmapped-model'
          ? { status: 'unknown' }
          : { status: 'confirmed', value: { model, contextWindow: 1000000 } }
      )
    } finally {
      await test.close()
    }
  }
)

it.each(['failure', 'unknown-window'])(
  'publishes a valid unknown context read to current and new observers: %s',
  async (mode) => {
    let reads = 0
    const test = await wireFixture({
      contextWindow: { model: native.model, tokens: 1000000 },
      async contextUsage() {
        if (reads++ === 0) return native
        if (mode === 'failure') throw new Error('context read failed')
        return { ...native, model: 'unmapped-model' }
      }
    })
    try {
      expect(await test.root.contextUsage()).toMatchObject({ status: 'confirmed' })
      await test.view.subscription.drain()
      expect(test.view.snapshot.contextUsage?.status).toBe('confirmed')
      const result = await test.root.contextUsage()
      expect(result).toMatchObject({
        status: 'unknown',
        error: { code: mode === 'failure' ? 'native-error' : 'unknown-window' }
      })
      await test.view.subscription.drain()
      expect(test.view.snapshot.contextUsage).toEqual(result)
      const late = await observe(test.root)
      await late.subscription.drain()
      expect(late.snapshot.contextUsage).toEqual(result)
      await late.subscription.stop()
    } finally {
      await test.close()
    }
  }
)

it.each(['model', 'read'])(
  'fences a late failed context read after a newer %s establishes a reading',
  async (change) => {
    let reads = 0
    let fail!: (error: Error) => void
    const pending = new Promise<SDKControlGetContextUsageResponse>((_resolve, reject) => {
      fail = reject
    })
    const test = await wireFixture({
      contextWindow: { model: native.model, tokens: 1000000 },
      contextUsage: async () => (++reads === 2 ? pending : native)
    })
    try {
      expect(await test.root.contextUsage()).toMatchObject({ status: 'confirmed' })
      const reading = test.root.contextUsage()
      await expect.poll(() => reads).toBe(2)
      if (change === 'model') await start(test, 'gateway-model[1m]')
      else expect(await test.root.contextUsage()).toMatchObject({ status: 'confirmed' })
      const current = test.view.snapshot.contextUsage
      expect(current).toMatchObject({
        status: 'confirmed',
        value: { model: change === 'model' ? 'gateway-model[1m]' : 'gateway-model' }
      })
      fail(new Error('late failure'))
      expect(await reading).toMatchObject({ status: 'unknown', error: { code: 'context-changed' } })
      await test.view.subscription.drain()
      expect(test.view.snapshot.contextUsage).toEqual(current)
    } finally {
      fail(new Error('cleanup'))
      await test.close()
    }
  }
)
