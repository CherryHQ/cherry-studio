import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

const { withReasoningParamFallback } = await import('../reasoningParamFallback')

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const badReasoning = () => jsonResponse(400, { error: { message: 'Invalid reasoning_effort' } })

describe('withReasoningParamFallback', () => {
  it('returns a successful response untouched', async () => {
    const ok = jsonResponse(200, { ok: true })
    const baseFetch = vi.fn(async () => ok)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'medium' })
    })

    expect(result).toBe(ok)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('passes through a 400 that does not blame reasoning parameters', async () => {
    const badModel = jsonResponse(400, { error: { message: 'model `gpt-6-luna` does not exist' } })
    const baseFetch = vi.fn(async () => badModel)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'medium' })
    })

    expect(result).toBe(badModel)
    expect(await result.text()).toContain('does not exist')
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('passes through a reasoning-related 400 when the request carries no reasoning fields', async () => {
    const rejection = badReasoning()
    const baseFetch = vi.fn(async () => rejection)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', messages: [] })
    })

    expect(result).toBe(rejection)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('retries once without reasoning fields when the endpoint rejects them', async () => {
    const ok = jsonResponse(200, { choices: [] })
    const baseFetch = vi.fn().mockResolvedValueOnce(badReasoning()).mockResolvedValueOnce(ok)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: JSON.stringify({
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium'
      })
    })

    expect(result).toBe(ok)
    expect(baseFetch).toHaveBeenCalledTimes(2)

    const retryInit = baseFetch.mock.calls[1][1] as RequestInit
    expect(retryInit.headers).toEqual({ Authorization: 'Bearer key' })
    const retryBody = JSON.parse(retryInit.body as string)
    expect(retryBody).toEqual({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'hi' }] })
    expect(retryBody).not.toHaveProperty('reasoning_effort')
  })

  it('strips the responses-format `reasoning` field as well', async () => {
    const ok = jsonResponse(200, {})
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: '"reasoning" is not supported' } }))
      .mockResolvedValueOnce(ok)
    const wrapped = withReasoningParamFallback(baseFetch)

    await wrapped('https://api.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', input: [], reasoning: { effort: 'high' } })
    })

    expect(baseFetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse((baseFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(retryBody).toEqual({ model: 'gpt-6-luna', input: [] })
  })

  it('retries at most once when the stripped request is also rejected', async () => {
    const baseFetch = vi.fn(async () => badReasoning())
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'medium' })
    })

    expect(result.status).toBe(400)
    expect(baseFetch).toHaveBeenCalledTimes(2)
  })

  it('never inspects or rewrites a non-string body', async () => {
    const rejection = badReasoning()
    const baseFetch = vi.fn(async () => rejection)
    const wrapped = withReasoningParamFallback(baseFetch)
    const formData = new FormData()

    const result = await wrapped('https://api.example.com/v1/audio/transcriptions', {
      method: 'POST',
      body: formData as unknown as BodyInit
    })

    expect(result).toBe(rejection)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('never inspects requests without a body', async () => {
    const rejection = badReasoning()
    const baseFetch = vi.fn(async () => rejection)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/models', { method: 'GET' })

    expect(result).toBe(rejection)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })
})
