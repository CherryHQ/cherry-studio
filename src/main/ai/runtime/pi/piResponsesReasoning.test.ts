import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { type Model, normalizeContext, type SimpleStreamOptions, Type } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withoutReasoningSummary, withReasoningSummarySuppressed } from './piResponsesReasoning'
import { loadPiOpenAiResponsesApi } from './piSdk'

const MARKER = 'responses-summary-repair-22480'
const context = normalizeContext({
  messages: [{ role: 'user', content: MARKER, timestamp: 1 }],
  tools: [{ name: 'read', description: 'Read a file', parameters: Type.Object({ path: Type.String() }) }]
})
const options: SimpleStreamOptions = {
  apiKey: 'test-key',
  reasoning: 'medium',
  maxRetries: 0,
  timeoutMs: 2_000
}

describe('Responses summary compatibility over HTTP', () => {
  let server: Server
  let model: Model<'openai-responses'>
  const requests: { raw: string; body: Record<string, any>; method?: string; url?: string; status: number }[] = []

  beforeEach(async () => {
    requests.length = 0
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString()
      const body = JSON.parse(raw)
      const rejected =
        body.reasoning !== null && typeof body.reasoning === 'object' && Object.hasOwn(body.reasoning, 'summary')
      requests.push({ raw, body, method: req.method, url: req.url, status: rejected ? 400 : 200 })
      if (rejected) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 'InvalidParameter', message: 'json: unknown field "summary"' }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const item = { id: 'msg-22480', type: 'message', role: 'assistant', content: [] }
      const events = [
        { type: 'response.created', response: { id: 'resp-22480', status: 'in_progress' } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: MARKER },
        {
          type: 'response.completed',
          response: {
            id: 'resp-22480',
            status: 'completed',
            output: [],
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
          }
        }
      ]
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
    server.requestTimeout = 3_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    model = {
      id: 'doubao-seed-evolving',
      name: 'Doubao Seed Evolving',
      provider: 'doubao',
      api: 'openai-responses',
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      reasoning: true,
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 8_192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  async function wrapped(overrides: SimpleStreamOptions = {}, selectedModel = model) {
    const api = await loadPiOpenAiResponsesApi()
    const config = withReasoningSummarySuppressed({ baseUrl: model.baseUrl, models: [] }, api.streamSimple)
    return config.streamSimple!(selectedModel, context, { ...options, ...overrides }).result()
  }

  it('reproduces the auto-summary 400 and repairs only that field while completing text', async () => {
    const api = await loadPiOpenAiResponsesApi()
    const control = await api.streamSimple(model, context, options).result()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/responses', status: 400 })
    expect(JSON.parse(requests[0].raw).reasoning.summary).toBe('auto')
    expect(control.stopReason).toBe('error')

    const repaired = await wrapped()
    expect(requests).toHaveLength(2)
    expect(requests[1].status).toBe(200)
    expect(repaired.stopReason).toBe('stop')
    expect(repaired.content).toContainEqual(expect.objectContaining({ type: 'text', text: MARKER }))
    expect(requests[1].body.reasoning.effort).toBe('medium')
    expect(Object.hasOwn(requests[1].body.reasoning, 'summary')).toBe(false)
    expect(requests[0].body.include).toContain('reasoning.encrypted_content')
    expect(requests[0].body.tools).toContainEqual(expect.objectContaining({ name: 'read' }))
    const controlBody = JSON.parse(requests[0].raw)
    delete controlBody.reasoning.summary
    expect(requests[1].body).toEqual(controlBody)
  })

  it.each([
    { reasoning: 'high' as const, thinkingLevelMap: undefined, effort: 'high' },
    { reasoning: 'medium' as const, thinkingLevelMap: { medium: 'low' }, effort: 'low' }
  ])(
    'preserves Pi effort $effort for $reasoning with its thinking map',
    async ({ reasoning, thinkingLevelMap, effort }) => {
      const selectedModel = { ...model, thinkingLevelMap }
      const api = await loadPiOpenAiResponsesApi()
      await api.streamSimple(selectedModel, context, { ...options, reasoning }).result()
      const result = await wrapped({ reasoning }, selectedModel)
      expect(requests).toHaveLength(2)
      expect(requests[0].body.reasoning.effort).toBe(effort)
      expect(requests[1].body.reasoning.effort).toBe(requests[0].body.reasoning.effort)
      expect(Object.hasOwn(requests[1].body.reasoning, 'summary')).toBe(false)
      expect(result.stopReason).toBe('stop')
    }
  )

  it.each(['replacement', 'mutation', 'absent'] as const)(
    'applies suppression after an async %s callback without losing caller changes',
    async (mode) => {
      const onPayload: SimpleStreamOptions['onPayload'] =
        mode === 'absent'
          ? undefined
          : async (payload) => {
              await Promise.resolve()
              const body = payload as Record<string, any>
              if (mode === 'replacement') {
                return {
                  ...body,
                  metadata: { marker: mode },
                  reasoning: { ...body.reasoning, summary: null, future: 'keep' }
                }
              }
              body.metadata = { marker: mode }
              body.reasoning.summary = null
              body.reasoning.future = 'keep'
              return undefined
            }
      const result = await wrapped({ onPayload })
      expect(requests).toHaveLength(1)
      expect(result.stopReason).toBe('stop')
      expect(Object.hasOwn(requests[0].body.reasoning, 'summary')).toBe(false)
      if (mode !== 'absent') {
        expect(requests[0].body.metadata).toEqual({ marker: mode })
        expect(requests[0].body.reasoning.future).toBe('keep')
      } else {
        expect(requests[0].body.input).toContainEqual(
          expect.objectContaining({
            role: 'user',
            content: [{ type: 'input_text', text: MARKER }]
          })
        )
      }
    }
  )

  it('passes an effective payload without reasoning through without creating or changing fields', async () => {
    let effective: unknown
    const result = await wrapped({
      onPayload: (payload) => {
        const body = payload as Record<string, unknown>
        delete body.reasoning
        effective = { ...body, metadata: { marker: 'no-reasoning' } }
        return effective
      }
    })
    expect(requests).toHaveLength(1)
    expect(result.stopReason).toBe('stop')
    expect(requests[0].body).toEqual(effective)
    expect(Object.hasOwn(requests[0].body, 'reasoning')).toBe(false)
  })

  it('rejects a null summary by presence, so null cannot masquerade as omission', async () => {
    const api = await loadPiOpenAiResponsesApi()
    const result = await api
      .streamSimple(model, context, {
        ...options,
        onPayload: (payload) => {
          const body = payload as Record<string, any>
          body.reasoning.summary = null
        }
      })
      .result()
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe(400)
    expect(result.stopReason).toBe('error')
  })
})

describe('withoutReasoningSummary', () => {
  it.each([undefined, null, false, 'reasoning', 3])('leaves non-object reasoning %s unchanged', (reasoning) => {
    const payload = { reasoning, include: ['reasoning.encrypted_content'] }
    expect(withoutReasoningSummary(payload)).toBe(payload)
    expect(payload.reasoning).toBe(reasoning)
    expect(payload.include).toEqual(['reasoning.encrypted_content'])
  })

  it('keeps reasoning identity, future siblings and inherited summary properties', () => {
    const reasoning = Object.assign(Object.create({ summary: 'inherited' }), {
      effort: 'medium',
      future: 'keep',
      summary: null
    })
    const payload = { reasoning }
    expect(withoutReasoningSummary(payload)).toBe(payload)
    expect(payload.reasoning).toBe(reasoning)
    expect(Object.hasOwn(reasoning, 'summary')).toBe(false)
    expect(reasoning.summary).toBe('inherited')
    expect(reasoning.effort).toBe('medium')
    expect(reasoning.future).toBe('keep')
  })
})
