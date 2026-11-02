import { describe, expect, it, vi } from 'vitest'

import anthropicListing from '../../src/__tests__/fixtures/dothoosh-anthropic-models.json'
import openaiListing from '../../src/__tests__/fixtures/dothoosh-v1-models.json'
import { dothooshProviderRows, readDothooshAnthropicListing, resolveDothooshRows } from '../dothoosh'

describe('dothooshProviderRows', () => {
  const rows = dothooshProviderRows(
    { openai: openaiListing, anthropic: anthropicListing },
    new Set(['gpt-5', 'deepseek-v4', 'kimi-k3', 'gemini-3-pro', 'claude-opus-5'])
  )
  const row = (modelId: string) => rows.find((r) => r.modelId === modelId)

  it('emits a provider-model row per served model with limits, prices, endpoints and modalities', () => {
    expect(row('gpt-5')).toMatchObject({
      providerId: 'dothoosh',
      modelId: 'gpt-5',
      endpointTypes: ['openai-responses', 'openai-chat-completions'],
      limits: { contextWindow: 400000, maxOutputTokens: 50000 },
      inputModalities: ['text', 'image'],
      pricing: {
        input: { perMillionTokens: 1.25 },
        inputTokenTiers: [{ minInputTokens: 128001 }, { minInputTokens: 272001 }]
      }
    })
  })

  it('splits a served id into the canonical model id and the wire apiModelId', () => {
    const [dotted] = dothooshProviderRows({ openai: { data: [{ id: 'gpt-6.1-sol' }] } }, new Set(['gpt-6-1-sol']))
    expect(dotted).toMatchObject({ modelId: 'gpt-6-1-sol', apiModelId: 'gpt-6.1-sol' })
    expect(row('gpt-5')).not.toHaveProperty('apiModelId')
  })

  it('carries capabilities from the listing', () => {
    expect(row('deepseek-v4')?.capabilities?.add).toEqual(expect.arrayContaining(['function-call', 'reasoning']))
    expect(row('deepseek-v4')?.capabilities?.remove).toContain('image-recognition')
  })

  it('names a model that has no base entry so the registry can serve it standalone', () => {
    expect(row('dual-model')).toMatchObject({ name: 'dual-model' })
    expect(row('gpt-5')).not.toHaveProperty('name')
  })

  it('omits limits and pricing the listing does not publish', () => {
    expect(row('dual-model')?.limits).toBeUndefined()
    expect(row('dual-model')?.pricing).toBeUndefined()
  })

  it('is sorted and unique by identity', () => {
    const keys = rows.map((r) => `${r.modelId} ${r.apiModelId ?? ''}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)))
  })
})

describe('resolveDothooshRows (mirror outage handling)', () => {
  const baseIds = new Set(['gpt-5', 'deepseek-v4', 'kimi-k3', 'gemini-3-pro'])
  const previous = [
    { providerId: 'dothoosh', modelId: 'gpt-5', pricing: { stale: true } },
    { providerId: 'openrouter', modelId: 'x' }
  ] as never[]
  const good = { openai: openaiListing, anthropic: anthropicListing }
  const run = async (load: () => Promise<{ openai: unknown; anthropic: unknown }>) => {
    const warnings: string[] = []
    const rows = await resolveDothooshRows(load, previous, baseIds, (m) => warnings.push(m))
    return { rows, warnings }
  }

  it('uses fresh rows when the listings are healthy', async () => {
    const { rows, warnings } = await run(async () => good)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.find((r) => r.modelId === 'gpt-5')?.pricing).not.toEqual({ stale: true })
    expect(warnings).toEqual([])
  })

  it.each([
    ['a fetch error', async () => Promise.reject(new Error('ECONNREFUSED'))],
    ['an HTTP 503', async () => Promise.reject(new Error('https://www.dothoosh.com/gateway/v1/models -> 503'))],
    ['an empty data list', async () => ({ openai: { data: [] }, anthropic: { data: [] } })],
    [
      'a short list (2 models)',
      async () => ({ openai: { data: openaiListing.data.slice(0, 2) }, anthropic: { data: [] } })
    ],
    ['a malformed body', async () => ({ openai: 'garbage', anthropic: null })],
    // One healthy listing must not mask a bad one: dropping either route's models shrinks the catalog silently.
    [
      'a healthy OpenAI listing and an Anthropic error envelope',
      async () => ({ openai: openaiListing, anthropic: { error: { type: 'overloaded_error' } } })
    ],
    [
      'a healthy OpenAI listing and an empty Anthropic listing',
      async () => ({ openai: openaiListing, anthropic: { data: [] } })
    ],
    [
      'a healthy OpenAI listing and a non-JSON Anthropic body',
      async () => ({ openai: openaiListing, anthropic: '<html>502</html>' })
    ],
    [
      'a healthy OpenAI listing and a missing Anthropic listing',
      async () => ({ openai: openaiListing, anthropic: undefined })
    ],
    [
      'a healthy OpenAI listing and an Anthropic listing of unusable entries',
      async () => ({ openai: openaiListing, anthropic: { data: [{ nope: 1 }, null] } })
    ],
    [
      'a healthy Anthropic listing and an OpenAI error envelope',
      async () => ({ openai: { error: 'rate limited' }, anthropic: anthropicListing })
    ],
    [
      'a healthy Anthropic listing and an empty OpenAI listing',
      async () => ({ openai: { data: [] }, anthropic: anthropicListing })
    ]
  ])('keeps the previously generated DotHoosh rows on %s', async (_name, load) => {
    const { rows, warnings } = await run(load)
    expect(rows).toEqual([previous[0]])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/keeping previous DotHoosh rows/i)
  })

  it('skips DotHoosh without failing when there are no previous rows', async () => {
    const warnings: string[] = []
    const rows = await resolveDothooshRows(
      async () => Promise.reject(new Error('down')),
      [],
      baseIds,
      (m) => warnings.push(m)
    )
    expect(rows).toEqual([])
    expect(warnings[0]).toMatch(/skipping DotHoosh/i)
  })
})

describe('readDothooshAnthropicListing (partial cached or network listings)', () => {
  const claudeA = { id: 'claude-a' }
  const claudeB = { id: 'claude-b' }

  it('rejects a partial cached listing (has_more: true) without fetching the network', async () => {
    const cached = vi.fn(async () => ({ data: [claudeA], has_more: true, last_id: 'claude-a' }))
    const fetchPage = vi.fn(async () => ({ data: [claudeB], has_more: false }))
    await expect(readDothooshAnthropicListing(cached, fetchPage)).rejects.toThrow(
      /DOTHOOSH_ANTHROPIC_CACHE holds a partial Anthropic listing/
    )
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('returns a complete cached listing with every model and without fetching the network', async () => {
    const cached = vi.fn(async () => ({ data: [claudeA, claudeB], has_more: false }))
    const fetchPage = vi.fn(async () => ({ data: [], has_more: false }))
    const listing = await readDothooshAnthropicListing(cached, fetchPage)
    expect(listing).toMatchObject({ data: [claudeA, claudeB] })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('follows last_id across network pages when there is no cache', async () => {
    const fetchPage = vi.fn(async (afterId?: string) =>
      afterId ? { data: [claudeB], has_more: false } : { data: [claudeA], has_more: true, last_id: 'claude-a' }
    )
    const listing = await readDothooshAnthropicListing(undefined, fetchPage)
    expect(listing).toMatchObject({ data: [claudeA, claudeB] })
    expect(fetchPage.mock.calls).toEqual([[undefined], ['claude-a']])
  })

  it('rejects when a later network page fails, returning no partial listing', async () => {
    const fetchPage = vi.fn(async (afterId?: string) => {
      if (afterId) throw new Error('HTTP 503')
      return { data: [claudeA], has_more: true, last_id: 'claude-a' }
    })
    await expect(readDothooshAnthropicListing(undefined, fetchPage)).rejects.toThrow('HTTP 503')
  })
})

describe('resolveDothooshRows (partial Anthropic listings)', () => {
  const baseIds = new Set(['gpt-5', 'deepseek-v4', 'kimi-k3', 'gemini-3-pro'])
  const dothooshRow = (modelId: string) => ({ providerId: 'dothoosh', modelId })
  const run = async (load: () => Promise<{ openai: unknown; anthropic: unknown }>, previous: object[]) => {
    const warnings: string[] = []
    const rows = await resolveDothooshRows(load, previous, baseIds, (m) => warnings.push(m))
    return { rows, warnings }
  }
  const previousRows = [
    dothooshRow('gpt-x'),
    dothooshRow('gpt-y'),
    dothooshRow('gpt-z'),
    dothooshRow('claude-a'),
    dothooshRow('claude-b')
  ]

  it('keeps the previous DotHoosh rows when the Anthropic listing is still marked has_more', async () => {
    const { rows, warnings } = await run(
      async () => ({
        openai: openaiListing,
        anthropic: { data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }
      }),
      previousRows
    )
    expect(rows).toEqual(previousRows)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/keeping previous DotHoosh rows/)
  })

  it('keeps the previous DotHoosh rows, including claude-a and claude-b, when the Anthropic listing is missing', async () => {
    const { rows, warnings } = await run(async () => ({ openai: openaiListing, anthropic: undefined }), previousRows)
    expect(rows.map((r) => r.modelId)).toEqual(expect.arrayContaining(['claude-a', 'claude-b']))
    expect(rows).toEqual(previousRows)
    expect(warnings).toHaveLength(1)
  })

  it('replaces the rows with both complete listings and drops a model absent from the new Anthropic listing', async () => {
    const previous = [dothooshRow('retired-model')]
    const { rows, warnings } = await run(async () => ({ openai: openaiListing, anthropic: anthropicListing }), previous)
    expect(rows.map((r) => r.modelId)).not.toContain('retired-model')
    expect(rows.map((r) => r.modelId)).toContain('claude-opus-5')
    expect(warnings).toEqual([])
  })
})
