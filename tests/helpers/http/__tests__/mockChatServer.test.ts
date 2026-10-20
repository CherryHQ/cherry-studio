import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { type MockChatServer, startMockChatServer } from '@test-helpers/http/mockChatServer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const prompt: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hello mock' }] }]

async function readText(reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>): Promise<string> {
  while (true) {
    const { value, done } = await reader.read()
    if (done) throw new Error('Stream ended before text arrived')
    if (value.type === 'text-delta' && value.delta) return value.delta
    if (value.type === 'error') throw value.error
  }
}

describe('mock chat HTTP server', () => {
  let server: MockChatServer

  beforeEach(async () => {
    server = await startMockChatServer()
  })

  afterEach(async () => {
    await server.close()
  })

  const providers = [
    { name: 'OpenAI', create: (baseURL: string) => createOpenAI({ baseURL, apiKey: 'mock-key' }).chat('mock-chat') },
    {
      name: 'OpenAI compatible',
      create: (baseURL: string) => createOpenAICompatible({ baseURL, name: 'mock' }).chatModel('mock-chat')
    }
  ]

  it('exposes a model that can be added through provider discovery', async () => {
    const response = await fetch(`${server.baseUrl}/models`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ object: 'list', data: [{ id: server.modelId }] })
  })

  describe.each(providers)('$name SDK', ({ create }) => {
    it('receives a complete non-streaming response over HTTP', async () => {
      const result = create(server.baseUrl).doGenerate({ prompt })
      const request = await server.nextRequest()
      expect(request.body).toMatchObject({
        model: server.modelId,
        messages: [{ role: 'user', content: 'Hello mock' }],
        stream: false
      })
      request.complete('Hello 世界\nsecond line')
      await expect(result).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Hello 世界\nsecond line' }],
        finishReason: { unified: 'stop' }
      })
      await request.closed
      expect(() => request.complete('duplicate')).toThrow('already closed')
    })

    it('delivers text before completion and ends with a normal finish', async () => {
      const result = create(server.baseUrl).doStream({ prompt })
      const request = await server.nextRequest()
      expect(request.body.stream).toBe(true)
      request.sendText('已收到\n')
      const reader = (await result).stream.getReader()
      expect(await readText(reader)).toBe('已收到\n')
      request.complete('后半段')
      expect(await readText(reader)).toBe('后半段')
      const remaining: LanguageModelV3StreamPart[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        remaining.push(value)
      }
      expect(remaining).toContainEqual(expect.objectContaining({ type: 'text-end' }))
      expect(remaining).toContainEqual(
        expect.objectContaining({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' } })
      )
      expect(remaining.some((part) => part.type === 'error')).toBe(false)
    })

    it('reports an in-stream provider error after partial text', async () => {
      const result = create(server.baseUrl).doStream({ prompt })
      const request = await server.nextRequest()
      request.sendText('partial answer')
      const reader = (await result).stream.getReader()
      expect(await readText(reader)).toBe('partial answer')
      request.fail('upstream unavailable')
      const remaining: LanguageModelV3StreamPart[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        remaining.push(value)
      }
      expect(remaining).toContainEqual({
        type: 'error',
        error: expect.objectContaining({ message: 'upstream unavailable' })
      })
      expect(remaining).toContainEqual(
        expect.objectContaining({ type: 'finish', finishReason: { unified: 'error', raw: undefined } })
      )
    })

    it('surfaces an actual transport failure after text has arrived', async () => {
      const result = create(server.baseUrl).doStream({ prompt })
      const request = await server.nextRequest()
      request.sendText('preserve this prefix')
      const reader = (await result).stream.getReader()
      expect(await readText(reader)).toBe('preserve this prefix')
      request.disconnect()
      await expect(reader.read()).rejects.toThrow()
      await request.closed
    })

    it('observes client cancellation while the server is holding a stream open', async () => {
      const abort = new AbortController()
      const result = create(server.baseUrl).doStream({ prompt, abortSignal: abort.signal })
      const request = await server.nextRequest()
      request.sendText('before stop')
      const reader = (await result).stream.getReader()
      expect(await readText(reader)).toBe('before stop')
      abort.abort()
      await expect(reader.read()).rejects.toThrow()
      await request.closed
      expect(() => request.sendText('after stop')).toThrow('already closed')
    })

    it('returns an HTTP error for a non-streaming failure', async () => {
      const result = create(server.baseUrl).doGenerate({ prompt })
      const rejected = expect(result).rejects.toThrow('mock failure')
      const request = await server.nextRequest()
      request.fail('mock failure')
      await rejected
    })
  })

  function post(body: unknown): Promise<Response> {
    return fetch(`${server.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('keeps concurrent requests independently controllable', async () => {
    const firstResponse = post({ model: 'first', messages: [], stream: true })
    const first = await server.nextRequest()
    const secondResponse = post({ model: 'second', messages: [], stream: true })
    const second = await server.nextRequest()
    expect(first.body.model).toBe('first')
    expect(second.body.model).toBe('second')
    second.complete('second answer')
    first.complete('first answer')
    const firstText = await (await firstResponse).text()
    const secondText = await (await secondResponse).text()
    expect(firstText).toContain('first answer')
    expect(firstText).not.toContain('second answer')
    expect(secondText).toContain('second answer')
    expect(secondText).not.toContain('first answer')
    expect(firstText).toMatch(/data: \[DONE\]\n\n$/)
    expect(secondText).toMatch(/data: \[DONE\]\n\n$/)
  })

  it('queues requests received before a consumer starts waiting', async () => {
    const response = await post({ model: server.modelId, messages: [], stream: true })
    const request = await server.nextRequest()
    request.complete('queued answer')
    expect(await response.text()).toContain('queued answer')
  })

  it('removes expired waits so the next request is not lost', async () => {
    await expect(server.nextRequest(10)).rejects.toThrow('Timed out')
    const waiting = server.nextRequest()
    const response = post({ model: server.modelId, messages: [] })
    const request = await waiting
    request.complete('after timeout')
    expect(await (await response).json()).toMatchObject({ choices: [{ message: { content: 'after timeout' } }] })
  })

  it('shuts down unfinished connections and rejects pending waits', async () => {
    const response = await post({ model: server.modelId, messages: [], stream: true })
    const request = await server.nextRequest()
    if (!response.body) throw new Error('Expected an SSE response body')
    const reader = response.body.getReader()
    await reader.read()
    const interrupted = expect(reader.read()).rejects.toThrow()
    const waiting = expect(server.nextRequest()).rejects.toThrow('server is closed')
    await server.close()
    await Promise.all([waiting, interrupted, request.closed])
    await expect(server.close()).resolves.toBeUndefined()
    await expect(server.nextRequest()).rejects.toThrow('server is closed')
  })

  it.each([null, {}, { model: 'mock-chat' }, { model: 'mock-chat', messages: [], stream: 'yes' }])(
    'rejects an invalid request without consuming the next request slot: %j',
    async (body) => {
      const waiting = server.nextRequest()
      expect((await post(body)).status).toBe(400)
      const response = post({ model: server.modelId, messages: [] })
      const request = await waiting
      request.complete('valid')
      expect((await response).status).toBe(200)
    }
  )

  it('rejects malformed JSON and unknown endpoints', async () => {
    const invalid = await fetch(`${server.baseUrl}/chat/completions`, { method: 'POST', body: '{' })
    expect(invalid.status).toBe(400)
    expect((await fetch(`${server.baseUrl}/unknown`)).status).toBe(404)
  })
})
