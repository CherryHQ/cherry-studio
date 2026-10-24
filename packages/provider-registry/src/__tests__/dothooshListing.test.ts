import { describe, expect, it } from 'vitest'

import { parseDotHooshListings, readAnthropicListing } from '../utils/dothooshListing'
import anthropicListing from './fixtures/dothoosh-anthropic-models.json'
import openaiListing from './fixtures/dothoosh-v1-models.json'

const usd = (perMillionTokens: number) => ({ currency: 'USD', perMillionTokens })
const byId = (models: ReturnType<typeof parseDotHooshListings>) => new Map(models.map((m) => [m.id, m]))

describe('parseDotHooshListings', () => {
  const models = byId(parseDotHooshListings({ openai: openaiListing, anthropic: anthropicListing }))

  it('converts per-token USD strings into per-million prices with cache and tiers', () => {
    expect(models.get('gpt-5')?.pricing).toEqual({
      input: usd(1.25),
      output: usd(10),
      cacheRead: usd(0.125),
      inputTokenTiers: [
        // `above_input_tokens: 128000` is exclusive, so Cherry's inclusive minimum is 128001.
        // The first tier publishes only a prompt price; the rest carries over from the base.
        { minInputTokens: 128001, input: usd(2), output: usd(10), cacheRead: usd(0.125) },
        { minInputTokens: 272001, input: usd(2.5), output: usd(15), cacheRead: usd(0.125) }
      ]
    })
  })

  it('maps the exclusive `above_input_tokens` to the first qualifying integer input count', () => {
    const tier = (above: number) => ({ above_input_tokens: above, prompt: '0.000002', completion: '0.00001' })
    const [model] = parseDotHooshListings({
      openai: {
        data: [
          {
            id: 't',
            pricing: { prompt: '0.000001', completion: '0.000005' },
            // Out of order and duplicated on purpose: the same threshold must collapse to one tier.
            pricing_tiers: [tier(272000), tier(100000), tier(100000)]
          }
        ]
      }
    })
    expect(model.pricing?.inputTokenTiers?.map((t) => t.minInputTokens)).toEqual([100001, 272001])
  })

  it('reads context and output limits from the listing', () => {
    expect(models.get('deepseek-v4')).toMatchObject({ contextWindow: 128000, maxOutputTokens: 16000 })
  })

  it('takes endpoint types from the listing a model appears in', () => {
    expect(models.get('deepseek-v4')?.endpointTypes).toEqual(['openai-chat-completions'])
    expect(models.get('kimi-k3')?.endpointTypes).toEqual(['openai-responses'])
    // A model that lists the Responses protocol is Responses-first: Chat Completions refuses GPT-6 tool use.
    expect(models.get('gpt-5')?.endpointTypes).toEqual(['openai-responses', 'openai-chat-completions'])
    expect(models.get('claude-opus-5')?.endpointTypes).toEqual(['anthropic-messages'])
    // Listed on both routes: OpenAI protocols first, then Anthropic.
    expect(models.get('dual-model')?.endpointTypes).toEqual(['openai-chat-completions', 'anthropic-messages'])
  })

  it('keeps Anthropic cache-write prices and display names', () => {
    const opus = models.get('claude-opus-5')
    expect(opus?.name).toBe('claude-opus-5')
    expect(opus?.pricing).toEqual({ input: usd(15), output: usd(75) })
  })

  it('derives capabilities and modalities from the listing, not constants', () => {
    expect(models.get('deepseek-v4')?.capabilities.add).toEqual(expect.arrayContaining(['function-call', 'reasoning']))
    expect(models.get('deepseek-v4')?.capabilities.remove).toEqual(
      expect.arrayContaining(['image-recognition', 'file-input', 'structured-output'])
    )
    expect(models.get('gpt-5')?.capabilities.add).toEqual(expect.arrayContaining(['structured-output']))
    expect(models.get('dual-model')?.capabilities.add).toEqual([])
    expect(models.get('deepseek-v4')?.inputModalities).toEqual(['text'])
  })

  it('adds image recognition when the listing accepts image input', () => {
    const [vision] = parseDotHooshListings({
      openai: {
        data: [{ id: 'v', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }]
      }
    })
    expect(vision.inputModalities).toEqual(['text', 'image'])
    expect(vision.capabilities.add).toContain('image-recognition')
    expect(vision.capabilities.remove).not.toContain('image-recognition')
  })

  it('omits pricing when the listing has no complete price', () => {
    expect(models.get('deepseek-v4')?.pricing).toBeUndefined()
    const [partial] = parseDotHooshListings({ openai: { data: [{ id: 'p', pricing: { prompt: '0.000001' } }] } })
    expect(partial.pricing).toBeUndefined()
  })

  it('rejects malformed entries instead of throwing', () => {
    expect(
      parseDotHooshListings({
        openai: { data: [{ id: '' }, { nope: true }, null, { id: 'ok', pricing: { prompt: 'x', completion: '-1' } }] }
      }).map((m) => m.id)
    ).toEqual(['ok'])
    expect(parseDotHooshListings({})).toEqual([])
    expect(parseDotHooshListings({ openai: 'garbage', anthropic: 42 })).toEqual([])
  })
})

describe('parseDotHooshListings — endpoint choice', () => {
  const protocols = (...names: string[]) => names.map((protocol) => ({ protocol }))
  const endpointsOf = (entry: object) =>
    parseDotHooshListings({ openai: { data: [{ id: 'm', ...entry }] } })[0]?.endpointTypes

  it('puts Responses first whatever order the listing names the protocols in', () => {
    expect(endpointsOf({ protocols: protocols('openai-chat-completions', 'openai-responses') })).toEqual([
      'openai-responses',
      'openai-chat-completions'
    ])
    expect(endpointsOf({ protocols: protocols('openai-responses', 'openai-chat-completions') })).toEqual([
      'openai-responses',
      'openai-chat-completions'
    ])
  })

  it('keeps a chat-only model on Chat Completions and a model listed on both families off the Anthropic route', () => {
    const [model] = parseDotHooshListings({
      openai: { data: [{ id: 'd', protocols: protocols('anthropic-messages', 'openai-chat-completions') }] },
      anthropic: { data: [{ id: 'd' }] }
    })
    expect(model.endpointTypes).toEqual(['openai-chat-completions', 'anthropic-messages'])
  })

  it('falls back to the Anthropic endpoint when the OpenAI listing names only that protocol', () => {
    expect(endpointsOf({ protocols: protocols('anthropic-messages') })).toEqual(['anthropic-messages'])
  })

  it('treats a model with no protocol list as Chat Completions only', () => {
    expect(endpointsOf({})).toEqual(['openai-chat-completions'])
  })
})

describe('parseDotHooshListings — tier carry-over', () => {
  const usd = (perMillionTokens: number) => ({ currency: 'USD', perMillionTokens })
  const priced = (pricing: object, pricing_tiers: object[]) =>
    parseDotHooshListings({ openai: { data: [{ id: 't', pricing, pricing_tiers }] } })[0].pricing

  it('takes a price a tier omits from the base price, not from the tier below it', () => {
    const pricing = priced({ prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001' }, [
      { above_input_tokens: 100000, prompt: '0.000002', completion: '0.00001' },
      { above_input_tokens: 200000, prompt: '0.000003' }
    ])
    expect(pricing?.inputTokenTiers).toEqual([
      { minInputTokens: 100001, input: usd(2), output: usd(10), cacheRead: usd(0.1) },
      { minInputTokens: 200001, input: usd(3), output: usd(5), cacheRead: usd(0.1) }
    ])
  })

  it('leaves a cache write that neither the base nor the tier prices unset, for usage pricing to bill at the tier input price', () => {
    const pricing = priced({ prompt: '0.000001', completion: '0.000005' }, [
      { above_input_tokens: 100000, prompt: '0.000002' },
      { above_input_tokens: 200000, prompt: '0.000004' }
    ])
    expect(pricing).not.toHaveProperty('cacheWrite')
    for (const tier of pricing?.inputTokenTiers ?? []) expect(tier).not.toHaveProperty('cacheWrite')
  })

  it('keeps the base cache-write price for a tier that omits it', () => {
    const pricing = priced({ prompt: '0.000001', completion: '0.000005', input_cache_write: '0.00000125' }, [
      { above_input_tokens: 100000, prompt: '0.000002' }
    ])
    expect(pricing?.inputTokenTiers?.[0].cacheWrite).toEqual(usd(1.25))
  })
})

describe('parseDotHooshListings — one bad optional field never drops the model', () => {
  const [model] = parseDotHooshListings({
    openai: {
      data: [
        {
          id: 'm',
          display_name: 7,
          context_length: 'big',
          max_output_tokens: -5,
          architecture: 'text',
          supported_parameters: 'tools',
          protocols: [{}, 5, { protocol: 'openai-responses' }],
          pricing: { prompt: '0.000001', completion: '0.000005' },
          pricing_tiers: [
            { above_input_tokens: 'x', prompt: '0.1' },
            { above_input_tokens: 0, prompt: '0.1' },
            { above_input_tokens: 100000, prompt: '0.000002' }
          ]
        }
      ]
    }
  })

  it('keeps the model and the parts of it that are well formed', () => {
    expect(model?.id).toBe('m')
    expect(model.endpointTypes).toEqual(['openai-responses'])
    expect(model.pricing?.input.perMillionTokens).toBe(1)
    expect(model.pricing?.inputTokenTiers?.map((t) => t.minInputTokens)).toEqual([100001])
  })

  it('drops only the unusable fields', () => {
    expect(model.name).toBe('m')
    expect(model.contextWindow).toBeUndefined()
    expect(model.maxOutputTokens).toBeUndefined()
    expect(model.inputModalities).toEqual(['text'])
  })
})

describe('readAnthropicListing', () => {
  const page = (ids: string[], more?: string) => ({
    data: ids.map((id) => ({ id })),
    has_more: more !== undefined,
    ...(more !== undefined ? { last_id: more } : {})
  })
  const ids = (listing: unknown) => (listing as { data: Array<{ id: string }> }).data.map((m) => m.id)

  it('follows has_more and last_id and merges every page', async () => {
    const seen: Array<string | undefined> = []
    const pages: Record<string, unknown> = { first: page(['a', 'b'], 'b'), b: page(['c']) }
    const listing = await readAnthropicListing(async (after) => {
      seen.push(after)
      return pages[after ?? 'first']
    })
    expect(seen).toEqual([undefined, 'b'])
    expect(ids(listing)).toEqual(['a', 'b', 'c'])
  })

  it('returns a single page as it is', async () => {
    expect(ids(await readAnthropicListing(async () => page(['a'])))).toEqual(['a'])
  })

  it.each([
    ['claims more pages without a cursor', async () => ({ data: [{ id: 'a' }], has_more: true })],
    ['repeats a cursor', async () => page(['a'], 'a')],
    ['is an error envelope', async () => ({ error: { type: 'api_error' } })]
  ])('rejects a listing that %s instead of returning part of it', async (_name, fetchPage) => {
    await expect(readAnthropicListing(fetchPage)).rejects.toThrow()
  })

  it('rejects an error envelope that follows good pages', async () => {
    const pages: Record<string, unknown> = { first: page(['a'], 'a'), a: { error: 'boom' } }
    await expect(readAnthropicListing(async (after) => pages[after ?? 'first'])).rejects.toThrow()
  })

  it('rejects a listing that never ends', async () => {
    let n = 0
    await expect(readAnthropicListing(async () => page([`m${n}`], `m${++n}`))).rejects.toThrow()
  })
})
