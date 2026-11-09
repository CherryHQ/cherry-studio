import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveAttachmentBudget } from '../attachmentBudget'
import { allocateAttachmentBudget, allocateInlineCaps } from '../attachmentInlineBudget'

describe('allocateAttachmentBudget', () => {
  // The defect this replaces: the cap was `max(READ_FILE_PAGE_SIZE, share)` per
  // file, so N attachments inlined N × 8000 no matter how small the share was.
  it('never exceeds the total, however many files ask for a share', () => {
    const sizes = new Array(1_000).fill(500_000)
    const allocated = allocateAttachmentBudget(sizes, 100_000)

    expect(sum(allocated)).toBeLessThanOrEqual(100_000)
    expect(sum(allocated)).toBeGreaterThan(0)
    expect(1_000 * READ_FILE_PAGE_SIZE).toBeGreaterThan(100_000) // the old floor would have blown it
  })

  // An equal split would truncate the big file at half the pool while the small
  // one leaves its half unused.
  it('serves small files whole and gives the rest to the large ones', () => {
    expect(allocateAttachmentBudget([10, 1_000], 100)).toEqual([10, 90])
  })

  it('leaves the pool alone when everything fits', () => {
    expect(allocateAttachmentBudget([10, 20], 1_000)).toEqual([10, 20])
  })

  it('allocates nothing rather than throwing on an exhausted or absent pool', () => {
    expect(allocateAttachmentBudget([100, 200], 0)).toEqual([0, 0])
    expect(allocateAttachmentBudget([100], -5)).toEqual([0])
    expect(allocateAttachmentBudget([], 100)).toEqual([])
  })
})

describe('allocateInlineCaps', () => {
  it('gives small files their whole body and shares the remaining byte budget', () => {
    expect(allocateInlineCaps(['a'.repeat(100), 'small'], 65)).toEqual([60, 5])
  })

  it('keeps mixed ASCII, CJK, emoji and malformed-surrogate prefixes within one shared budget', () => {
    const bodies = ['一'.repeat(200) + 'a'.repeat(400), 'b'.repeat(2000), '😀'.repeat(100), '\uD800'.repeat(100)]
    const caps = allocateInlineCaps(bodies, 120)
    const retained = bodies.map((body, i) => body.slice(0, caps[i]))
    expect(retained.reduce((total, body) => total + Buffer.byteLength(body, 'utf8'), 0)).toBeLessThanOrEqual(120)
    expect(retained.every((body) => body.length > 0)).toBe(true)
    expect(retained[2].length % 2).toBe(0)
  })

  it('bounds a huge compressible attachment without exact BPE counting', () => {
    const body = 'A'.repeat(5 * 1024 * 1024)
    const [cap] = allocateInlineCaps([body], 8000)
    expect(cap).toBe(8000)
  })

  it('retains fitting files and emits no content for an exhausted pool', () => {
    expect(allocateInlineCaps(['short', ''], 1000)).toEqual([5, 0])
    expect(allocateInlineCaps(['text', '😀'], 0)).toEqual([0, 0])
    expect(allocateInlineCaps(['text'], -1)).toEqual([0])
  })
})

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

it('#22441 prices duplicate history as one surviving pair while distinct ids cost two pairs', async () => {
  const price = (parts: UIMessage['parts']) =>
    resolveAttachmentBudget({
      provider: { id: 'test', endpointConfigs: {} } as Provider,
      model: {
        id: 'test::model',
        providerId: 'test',
        name: 'Test model',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        contextWindow: 100_000
      } satisfies Model,
      system: undefined,
      tools: undefined,
      maxOutputTokens: 1_000,
      messages: [{ id: 'history', role: 'assistant', parts }],
      mediaCapabilities: { image: false, video: false, audio: false }
    })
  const winner = {
    type: 'dynamic-tool',
    toolName: 'lookup',
    toolCallId: 'one',
    state: 'output-available',
    input: { query: 'winner' },
    output: { answer: 'retained' }
  } satisfies UIMessage['parts'][number]
  const loser = { ...winner, input: { query: 'loser'.repeat(100) }, output: { answer: 'discarded'.repeat(100) } }
  const single = await price([winner])
  const duplicate = await price([winner, loser])
  const distinct = await price([winner, { ...winner, toolCallId: 'two' }])
  expect(single).not.toBeNull()
  expect(duplicate?.tokens).toBe(single?.tokens)
  expect(distinct).not.toBeNull()
  expect(distinct!.tokens).toBeLessThan(single!.tokens)
})
