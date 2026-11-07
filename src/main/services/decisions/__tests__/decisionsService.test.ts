import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type DecisionsRequest, DecisionsRequestSchema, DecisionsResponseSchema } from '@shared/ipc/schemas/decisions'

const getByProviderId = vi.fn()
const getRotatedApiKey = vi.fn()

vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId, getRotatedApiKey } }))

const { decisionsService, DecisionsError } = await import('../decisionsService')

/** Official request example from https://openrouter.ai/openapi.json (`POST /api/alpha/decisions`). */
const OFFICIAL_REQUEST: DecisionsRequest = {
  model: 'typesafe/jev-1.13',
  questions: {
    is_bug: {
      criteria: {
        false: 'The customer is asking a question or requesting a feature.',
        true: 'The customer describes broken or unexpected product behavior.'
      },
      instructions: 'Is the customer reporting a software defect?',
      type: 'noul'
    },
    team: {
      criteria: {
        account: 'Login, permissions, or profile issues.',
        frontend: 'Rendering, layout, or browser compatibility issues.',
        payments: 'Checkout, billing, or payment processing issues.'
      },
      instructions: 'Which team should own this ticket?',
      type: 'choice'
    },
    urgency: {
      criteria: ['Can wait for the next release', 'Should be fixed this week', 'Blocking revenue right now'],
      instructions: 'How urgent is this ticket?',
      type: 'score'
    }
  },
  state: {
    customer_tier: 'enterprise',
    ticket: 'My checkout page shows a blank screen after I click Pay. I have tried two browsers.'
  }
}

/** Official success example from https://openrouter.ai/openapi.json (`POST /api/alpha/decisions` 200). */
const OFFICIAL_RESPONSE = {
  answers: {
    is_bug: {
      noul: 0.96,
      type: 'noul'
    },
    team: {
      choice: 'payments',
      confidence: 0.75,
      probabilities: {
        account: 0,
        frontend: 0.16,
        payments: 0.84
      },
      type: 'choice'
    },
    urgency: {
      confidence: 0.99,
      legend: {
        '0': 'Can wait for the next release',
        '1': 'Should be fixed this week',
        '2': 'Blocking revenue right now'
      },
      probabilities: {
        '0': 0,
        '1': 0.01,
        '2': 0.99
      },
      score: 1.99,
      type: 'score'
    }
  },
  id: 'gen-dec-1789738314-X5e5eKGQdvR9rblyX250',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  usage: {
    cost: 1.9992e-5,
    input_tokens: 476,
    output_tokens: 70
  }
}

const request: DecisionsRequest = {
  model: 'typesafe/jev-1.13',
  state: { ticket: 'Checkout fails' },
  questions: { is_bug: { type: 'noul', instructions: 'Is this a defect?' } }
}

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('decisions schemas', () => {
  it('accepts the official Decisions request example', () => {
    expect(DecisionsRequestSchema.safeParse(OFFICIAL_REQUEST).success).toBe(true)
  })

  it('accepts the official Decisions success example, including its envelope metadata', () => {
    const parsed = DecisionsResponseSchema.safeParse(OFFICIAL_RESPONSE)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.answers.is_bug).toMatchObject({ type: 'noul', noul: 0.96 })
    expect(parsed.data?.answers.team).toMatchObject({ type: 'choice', choice: 'payments' })
    expect(parsed.data?.answers.urgency).toMatchObject({ type: 'score', score: 1.99 })
  })

  it('rejects a legacy array-shaped questions payload', () => {
    expect(DecisionsRequestSchema.safeParse({ model: 'm', state: {}, questions: [{ id: 'q1' }] }).success).toBe(false)
  })
})

describe('decisionsService.create', () => {
  beforeEach(() => {
    getByProviderId.mockReturnValue({
      endpointConfigs: {
        // Anthropic first, as in the registry preset: order must not decide the destination.
        'anthropic-messages': { baseUrl: 'https://anthropic.example' },
        'openai-chat-completions': { baseUrl: 'https://proxy.example/api/v1/' }
      },
      defaultChatEndpoint: 'openai-chat-completions'
    })
    getRotatedApiKey.mockReturnValue('sk-test')
  })

  it('posts model/state/questions to the primary chat endpoint origin with bearer auth', async () => {
    const fetchMock = mockFetch(OFFICIAL_RESPONSE)
    const result = await decisionsService.create(request)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proxy.example/api/alpha/decisions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body)).toEqual(request)
    expect(result.answers.team).toMatchObject({ type: 'choice', choice: 'payments' })
  })

  it('forwards the question map to OpenRouter unchanged', async () => {
    const fetchMock = mockFetch(OFFICIAL_RESPONSE)
    await decisionsService.create(OFFICIAL_REQUEST)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(OFFICIAL_REQUEST)
  })

  it('parses choice, noul, score, box and refusal answers keyed by question ID', async () => {
    mockFetch({
      model: 'typesafe/jev-1.13',
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        a: { type: 'choice', choice: 'x' },
        b: { type: 'noul', noul: 0.5 },
        c: { type: 'score', score: 1.5 },
        d: { type: 'box', box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 } },
        e: { type: 'refusal' }
      }
    })
    const { answers } = await decisionsService.create(request)
    expect(Object.values(answers).map((a) => a.type)).toEqual(['choice', 'noul', 'score', 'box', 'refusal'])
  })

  it('falls back to openrouter.ai when no base URL is configured', async () => {
    getByProviderId.mockReturnValue({})
    const fetchMock = mockFetch(OFFICIAL_RESPONSE)
    await decisionsService.create(request)
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions')
  })

  it('throws a typed error on HTTP failure', async () => {
    mockFetch('nope', 401)
    await expect(decisionsService.create(request)).rejects.toMatchObject({ name: 'DecisionsError', status: 401 })
  })

  it('rejects malformed answers', async () => {
    mockFetch({
      model: 'm',
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: { c: { type: 'score', score: 'high' } }
    })
    await expect(decisionsService.create(request)).rejects.toBeInstanceOf(DecisionsError)
  })

  it('rejects a success response missing the documented usage envelope', async () => {
    mockFetch({ answers: {} })
    await expect(decisionsService.create(request)).rejects.toBeInstanceOf(DecisionsError)
  })
})
