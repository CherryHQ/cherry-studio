import { describe, expect, it } from 'vitest'

import { remoteLimits } from '@cherrystudio/remote-protocol'
import { agentMethods, partSchema } from '@cherrystudio/remote-protocol/agent'

import { DEFAULT_PAGE, PAGE_ITEM_BYTES, pageOf, queryPage } from '../agentPagination'

describe('agent page byte budget', () => {
  it('includes the exact boundary and leaves the overflowing item at the next offset', () => {
    const first = 'a'.repeat(30_000)
    const second = 'b'.repeat(PAGE_ITEM_BYTES - 30_005)
    expect(pageOf([first, second], undefined, 100)).toEqual({ items: [first, second], nextCursor: null })
    expect(pageOf([first, second + 'b'], undefined, 100)).toEqual({ items: [first], nextCursor: '1' })
    expect(pageOf([first, second + 'b'], '1', 100)).toEqual({ items: [second + 'b'], nextCursor: null })
  })

  it('walks every item exactly once in order across shortened pages', () => {
    const items = Array.from({ length: 103 }, (_, id) => ({ id, text: 'a'.repeat(8_000) }))
    const received: typeof items = []
    let cursor: string | undefined
    do {
      const page = pageOf(items, cursor, 20)
      received.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined && received.length <= items.length)
    expect(received).toEqual(items)
  })

  it('counts JSON escapes and multibyte BMP text rather than UTF-16 or raw UTF-8', () => {
    const count = (text: string) =>
      pageOf(
        Array.from({ length: 20 }, () => ({ text })),
        undefined,
        20
      ).items.length
    expect(count('a'.repeat(4096))).toBe(15)
    expect(count('漢'.repeat(4096))).toBe(5)
    expect(count('\u0000'.repeat(4096))).toBe(2)
  })

  it('refuses an indivisible item, including one encountered after a fitting prefix', () => {
    const huge = 'a'.repeat(PAGE_ITEM_BYTES)
    const failure = expect.objectContaining({
      data: expect.objectContaining({
        reason: 'RESOURCE_EXHAUSTED',
        details: {
          kind: 'ITEM_TOO_LARGE',
          itemBytes: PAGE_ITEM_BYTES + 2,
          budgetBytes: PAGE_ITEM_BYTES,
          retryable: false
        }
      })
    })
    expect(() => pageOf([huge], undefined, 1)).toThrowError(failure)
    expect(pageOf(['small', huge], undefined, 100)).toEqual({ items: ['small'], nextCursor: '1' })
    expect(() => pageOf(['small', huge], '1', 100)).toThrowError(failure)
    expect(() => queryPage(() => ({ items: [huge], nextCursor: null }), 100)).toThrowError(failure)
  })

  it.each(['invalid', '-1', '1.5', '9007199254740992'])('retains NOT_FOUND for cursor %s', (cursor) => {
    expect(() => pageOf([1], cursor, 1)).toThrowError(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'NOT_FOUND' }) })
    )
  })

  it.each([undefined, 1, 100])('preserves small pages and terminal cursors at limit %s', (limit) => {
    const items = Array.from({ length: 101 }, (_, id) => id)
    const count = limit ?? DEFAULT_PAGE
    expect(pageOf(items, undefined, limit)).toEqual({ items: items.slice(0, count), nextCursor: String(count) })
    expect(pageOf(items, '100', limit)).toEqual({ items: [100], nextCursor: null })
    expect(pageOf(items, '101', limit)).toEqual({ items: [], nextCursor: null })
  })

  it('returns a fitting service page unchanged with only one read', () => {
    const page = { items: ['first'], nextCursor: 'service-cursor' }
    let reads = 0
    expect(
      queryPage(() => {
        if (++reads > 1) throw new Error('A fitting page must not be queried again')
        return page
      }, undefined)
    ).toBe(page)
    expect(reads).toBe(1)
  })

  it('shrinks an overflowing query and preserves its service cursor', () => {
    const items = ['a'.repeat(30_000), 'b'.repeat(30_000), 'c'.repeat(30_000)]
    const result = queryPage((limit) => {
      return { items: items.slice(0, limit), nextCursor: `after-${limit}` }
    }, 5)
    expect(result).toEqual({ items: items.slice(0, 2), nextCursor: 'after-2' })
  })

  it('passes through an empty pin transition and refuses a limit-one oversized query', () => {
    const transition = { items: [], nextCursor: 'entity:' }
    expect(queryPage(() => transition, 20)).toBe(transition)
    expect(() => queryPage(() => ({ items: ['a'.repeat(PAGE_ITEM_BYTES)], nextCursor: null }), 1)).toThrowError(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'RESOURCE_EXHAUSTED' }) })
    )
  })

  it('reserves the maximal escaped envelope for schema-valid workspace DTOs', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ workspaceId: String(i), name: '' }))
    let remaining = PAGE_ITEM_BYTES - items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0)
    for (const item of items) {
      const size = Math.min(4096, remaining)
      item.name = 'a'.repeat(size)
      remaining -= size
    }
    const result = agentMethods['agent.workspaces.list'].result.parse({
      items,
      nextCursor: '\u0000'.repeat(256),
      systemWorkspace: true
    })
    const response = { jsonrpc: '2.0', id: '\u0000'.repeat(256), result }
    expect(Buffer.byteLength(JSON.stringify(response))).toBe(remoteLimits.recordBytes)
    expect(pageOf(items, undefined, 100).items.length).toBeLessThan(100)
  })

  it('fits escaped identity and model limits with large usage and failure summaries', () => {
    const text = '\u0000'
    const message = {
      messageId: text.repeat(256),
      revision: '9'.repeat(40),
      role: 'assistant',
      status: 'error',
      partsMode: 'paged',
      model: { modelId: text.repeat(2048), providerId: text.repeat(256), name: text.repeat(2048) },
      usage: {
        costs: Array.from({ length: 32 }, () => ({
          currency: 'USD',
          amount: Number.MAX_VALUE,
          providerReportedRequestCount: Number.MAX_SAFE_INTEGER,
          computedRequestCount: Number.MAX_SAFE_INTEGER
        }))
      },
      failure: {
        message: 'f'.repeat(1024),
        retryable: false,
        failure: {
          version: 1,
          reasonCode: 'unknown',
          source: { layer: 'host' },
          context: { responseBody: 'f'.repeat(2800) }
        }
      }
    }
    const result = agentMethods['agent.messages.list'].result.parse({ items: [message], nextCursor: text.repeat(256) })
    expect(pageOf(result.items, undefined, 1).items).toEqual([message])
    expect(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: text.repeat(256), result }))).toBeLessThanOrEqual(
      remoteLimits.recordBytes
    )
  })

  it('measures schema-valid oversized inline content and retained extension fields', () => {
    const part = partSchema.parse({
      partId: 'p',
      revision: '1',
      kind: 'text',
      state: 'completed',
      content: { text: 'a'.repeat(64_000) }
    })
    const extended = partSchema.parse({
      partId: 'p',
      revision: '1',
      kind: 'text',
      state: 'completed',
      content: { text: 'small' },
      extension: 'a'.repeat(64_000)
    })
    for (const item of [part, extended]) {
      expect(() => pageOf([item], undefined, 1)).toThrowError(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'RESOURCE_EXHAUSTED' }) })
      )
    }
  })
})
