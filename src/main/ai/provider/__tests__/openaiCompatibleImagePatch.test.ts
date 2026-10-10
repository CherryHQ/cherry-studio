import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

// Guards patches/@ai-sdk__openai-compatible@2.0.72.patch: `response_format: 'b64_json'` is
// retried away on a 400 (#18147, #18323, #18662) and `url` replies parse (#14579).
describe('patched @ai-sdk/openai-compatible image model', () => {
  const options = { prompt: 'a fox', n: 1, providerOptions: {} } as ImageModelV3CallOptions

  const ok = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'content-type': 'application/json' }
    })

  /** Records every outgoing body; `respond` sees the 0-based attempt index. */
  function model(respond: (attempt: number) => Response, modelId = 'agnes-image-2.1-flash') {
    const bodies: Array<Record<string, unknown>> = []
    const image = new OpenAICompatibleImageModel(modelId, {
      provider: 'agnes',
      url: ({ path }) => `https://apihub.agnes-ai.com/v1${path}`,
      headers: () => ({}),
      fetch: (async (_url: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return respond(bodies.length - 1)
      }) as unknown as typeof globalThis.fetch
    })
    return { image, bodies }
  }

  it('asks for b64_json first', async () => {
    const { image, bodies } = model(() => ok({ data: [{ b64_json: 'QUJD' }] }))

    const result = await image.doGenerate(options)

    expect(bodies).toHaveLength(1)
    expect(bodies[0].response_format).toBe('b64_json')
    expect(result.images).toEqual(['QUJD'])
  })

  it('retries without response_format when the model rejects it with a 400', async () => {
    const { image, bodies } = model((attempt) =>
      attempt === 0
        ? fail(400, 'Setting `response_format` is not supported by openai, agnes-t2i-general-model')
        : ok({ data: [{ url: 'https://img/a.png' }] })
    )

    const result = await image.doGenerate(options)

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).not.toHaveProperty('response_format')
    expect(result.images).toEqual(['https://img/a.png'])
  })

  it('retries a 422 too — strict gateways reject unknown body fields with it', async () => {
    const { image, bodies } = model((attempt) =>
      attempt === 0 ? fail(422, 'Unprocessable Entity: response_format') : ok({ data: [{ b64_json: 'QUJD' }] })
    )

    const result = await image.doGenerate(options)

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).not.toHaveProperty('response_format')
    expect(result.images).toEqual(['QUJD'])
  })

  it('does not retry a non-400 failure', async () => {
    const { image, bodies } = model(() => fail(401, 'Invalid API key'))

    await expect(image.doGenerate(options)).rejects.toBeInstanceOf(APICallError)
    expect(bodies).toHaveLength(1)
  })

  it('surfaces the original rejection when the retry fails too', async () => {
    const { image, bodies } = model((attempt) =>
      attempt === 0 ? fail(400, 'response_format is not supported') : fail(500, 'upstream exploded')
    )

    await expect(image.doGenerate(options)).rejects.toMatchObject({
      statusCode: 400,
      responseBody: expect.stringContaining('response_format is not supported')
    })
    expect(bodies).toHaveLength(2)
  })

  it('honours an explicit response_format and never retries it away', async () => {
    const { image, bodies } = model((attempt) => (attempt === 0 ? fail(400, 'nope') : ok({ data: [] })))

    await expect(
      image.doGenerate({ ...options, providerOptions: { agnes: { response_format: 'url' } } })
    ).rejects.toBeInstanceOf(APICallError)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].response_format).toBe('url')
  })

  it('omits response_format for models whose API rejects the field outright', async () => {
    const { image, bodies } = model(() => ok({ data: [{ b64_json: 'QUJD' }] }), 'gpt-image-1')

    await image.doGenerate(options)

    expect(bodies[0]).not.toHaveProperty('response_format')
  })
})
