import { beforeEach, describe, expect, it, vi } from 'vitest'

const getByProviderId = vi.fn()
const getRotatedApiKey = vi.fn()

vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId, getRotatedApiKey } }))

const { decisionsService, DecisionsError } = await import('../decisionsService')

const request = { model: 'typesafe/jev-1.13', state: { a: 1 }, questions: [{ id: 'q1' }] }

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('decisionsService.create', () => {
  beforeEach(() => {
    getByProviderId.mockReturnValue({
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://proxy.example/api/v1/' } }
    })
    getRotatedApiKey.mockReturnValue('sk-test')
  })

  it('posts model/state/questions to the provider origin with bearer auth', async () => {
    const fetchMock = mockFetch({ answers: [{ type: 'choice', id: 'q1', value: 'yes' }] })
    const result = await decisionsService.create(request)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proxy.example/api/alpha/decisions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body)).toEqual(request)
    expect(result.answers).toEqual([{ type: 'choice', id: 'q1', value: 'yes' }])
  })

  it('parses choice, noul and score answers', async () => {
    mockFetch({
      answers: [
        { type: 'choice', id: 'a', value: 'x' },
        { type: 'noul', id: 'b', value: null },
        { type: 'score', id: 'c', value: 0.5 }
      ]
    })
    const { answers } = await decisionsService.create(request)
    expect(answers.map((a) => a.type)).toEqual(['choice', 'noul', 'score'])
  })

  it('falls back to openrouter.ai when no base URL is configured', async () => {
    getByProviderId.mockReturnValue({})
    const fetchMock = mockFetch({ answers: [] })
    await decisionsService.create(request)
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions')
  })

  it('throws a typed error on HTTP failure', async () => {
    mockFetch('nope', 401)
    await expect(decisionsService.create(request)).rejects.toMatchObject({ name: 'DecisionsError', status: 401 })
  })

  it('rejects malformed answers', async () => {
    mockFetch({ answers: [{ type: 'score', id: 'c', value: 'high' }] })
    await expect(decisionsService.create(request)).rejects.toBeInstanceOf(DecisionsError)
  })
})
