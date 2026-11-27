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

  it('retries on a structured envelope naming reasoning_effort as the rejected parameter', async () => {
    const ok = jsonResponse(200, {})
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { param: 'reasoning_effort', message: 'unsupported value' } }))
      .mockResolvedValueOnce(ok)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'xhigh' })
    })

    expect(result).toBe(ok)
    expect(baseFetch).toHaveBeenCalledTimes(2)
  })

  it('retries when a message-only envelope puts the rejection wording before the field name', async () => {
    const ok = jsonResponse(200, {})
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(400, { error: { message: 'Unrecognized request argument supplied: reasoning' } })
      )
      .mockResolvedValueOnce(ok)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', input: [], reasoning: { effort: 'high' } })
    })

    expect(result).toBe(ok)
    expect(baseFetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse((baseFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(retryBody).not.toHaveProperty('reasoning')
  })

  it('preserves the original 400 when a structured envelope blames model, even if the model id mentions reasoning', async () => {
    const modelError = jsonResponse(400, {
      error: { param: 'model', message: 'The model `reasoning_effort-v2` does not exist' }
    })
    const baseFetch = vi.fn(async () => modelError)
    const wrapped = withReasoningParamFallback(baseFetch)

    const result = await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'reasoning_effort-v2', reasoning_effort: 'medium' })
    })

    expect(result).toBe(modelError)
    expect(baseFetch).toHaveBeenCalledTimes(1)
  })

  it('retries a nested structured reasoning path without preserving the rejected field', async () => {
    const ok = jsonResponse(200, {})
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: { param: 'reasoning.effort', message: 'Unsupported value' }
        })
      )
      .mockResolvedValueOnce(ok)
    const result = await withReasoningParamFallback(baseFetch)('https://api.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'test-model', input: [], reasoning: { effort: 'high' } })
    })
    expect(result).toBe(ok)
    expect(baseFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(baseFetch.mock.calls[1][1].body)).toEqual({ model: 'test-model', input: [] })
  })

  it.each([
    'Invalid model id: reasoning_effort-v2',
    'The requested model ID: `reasoning_effort` is not supported.',
    'Unknown model "reasoning"',
    'Invalid reasoning_effort-v2',
    'The model "reasoning" is not supported',
    'The model `reasoning_effort` is not supported',
    'The selected model with ID `reasoning_effort` does not support image input'
  ])('preserves message-only model diagnostics: %s', async (message) => {
    const original = jsonResponse(400, { error: { message } })
    const baseFetch = vi.fn(async () => original)
    const result = await withReasoningParamFallback(baseFetch)('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'reasoning_effort-v2', reasoning_effort: 'high' })
    })
    expect(baseFetch).toHaveBeenCalledTimes(1)
    expect(result).toBe(original)
    expect(await result.json()).toEqual({ error: { message } })
  })

  it.each([
    'invalid_request_error: reasoning.effort value "none" is not supported',
    'For this model: reasoning_effort is not supported.',
    'Invalid reasoning_effort for model with ID `reasoning_effort`.',
    "'reasoning_effort' does not support null",
    "Unsupported value: 'reasoning_effort' does not support 'none' with this model"
  ])('retries field-specific rejected effort values: %s', async (message) => {
    const ok = jsonResponse(200, {})
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message } }))
      .mockResolvedValueOnce(ok)
    const result = await withReasoningParamFallback(baseFetch)('https://api.example.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'test-model', reasoning_effort: 'none', reasoning: { effort: 'none' } })
    })
    expect(baseFetch).toHaveBeenCalledTimes(2)
    expect(result).toBe(ok)
    expect(JSON.parse(baseFetch.mock.calls[1][1].body)).toEqual({ model: 'test-model' })
  })

  it('does not parse the request body on a non-400 response', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse')
    const baseFetch = vi.fn(async () => jsonResponse(200, { ok: true }))
    const wrapped = withReasoningParamFallback(baseFetch)

    await wrapped('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'medium' })
    })

    expect(parseSpy).not.toHaveBeenCalled()
    parseSpy.mockRestore()
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
