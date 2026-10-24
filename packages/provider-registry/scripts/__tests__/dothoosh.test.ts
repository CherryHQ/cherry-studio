import { describe, expect, it } from 'vitest'

import anthropicListing from '../../src/__tests__/fixtures/dothoosh-anthropic-models.json'
import openaiListing from '../../src/__tests__/fixtures/dothoosh-v1-models.json'
import { dothooshProviderRows, resolveDothooshRows } from '../dothoosh'

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
