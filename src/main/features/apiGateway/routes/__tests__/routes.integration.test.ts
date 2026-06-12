import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests that drive the real Elysia app via `app.handle(Request)`.
 *
 * They verify the idiomatic route wiring end-to-end: declarative schema
 * validation (auto-400), the per-dialect `onError` envelopes (OpenAI vs
 * Anthropic), auth short-circuiting, and `status()`-based responses.
 * (Knowledge route behaviour is covered in ../knowledge/__tests__.)
 */

// All mock fns live in vi.hoisted so the (hoisted) vi.mock factories can close
// over them without a TDZ error.
const { mockPreferenceGet, mockProcessMessage, mockGetModels } = vi.hoisted(() => ({
  mockPreferenceGet: vi.fn<(key: string) => unknown>(() => 'test-key'),
  mockProcessMessage: vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  ),
  mockGetModels: vi.fn(async () => ({ object: 'list', data: [{ id: 'openai:gpt-4' }] }))
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: { get: mockPreferenceGet }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

// Heavy services are stubbed so building the app + exercising handlers never
// touches the real AiService / data layer.
vi.mock('../../proxyStream', () => ({
  processMessage: mockProcessMessage,
  default: { processMessage: mockProcessMessage }
}))

vi.mock('../../utils/models', () => ({
  getModels: mockGetModels
}))

// Knowledge routes use the v2 KB service (pulled in by buildApp); stubbed so
// building the app stays hermetic (knowledge behaviour tested separately).
vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { list: vi.fn(async () => ({ items: [], total: 0, page: 1 })), getById: vi.fn() }
}))

import { buildApp } from '../../app'

const AUTH = { 'content-type': 'application/json', 'x-api-key': 'test-key' }

function post(app: ReturnType<typeof buildApp>, path: string, body: unknown, headers: Record<string, string> = AUTH) {
  return app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
}
function get(app: ReturnType<typeof buildApp>, path: string, headers: Record<string, string> = AUTH) {
  return app.handle(new Request(`http://localhost${path}`, { method: 'GET', headers }))
}
async function read(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() }
}

describe('API gateway routes (integration)', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReturnValue('test-key')
    app = buildApp()
  })

  describe('public routes', () => {
    it('GET /health → 200', async () => {
      const { status, body } = await read(await get(app, '/health', {}))
      expect(status).toBe(200)
      expect(body.status).toBe('ok')
    })

    it('GET / → 200 API info', async () => {
      const { status, body } = await read(await get(app, '/', {}))
      expect(status).toBe(200)
      expect(body.name).toBe('Cherry Studio API')
      expect(body.endpoints).toBeDefined()
    })
  })

  describe('auth', () => {
    it('rejects unauthenticated /v1 requests with 401', async () => {
      const { status, body } = await read(await get(app, '/v1/models', {}))
      expect(status).toBe(401)
      expect(body.error).toMatch(/Unauthorized/)
    })

    it('authenticates a /v1 request via the Authorization: Bearer header (@elysia/bearer)', async () => {
      const { status } = await read(await get(app, '/v1/models', { authorization: 'Bearer test-key' }))
      expect(status).toBe(200)
    })

    it('rejects a /v1 request with an invalid Bearer token (403)', async () => {
      const { status } = await read(await get(app, '/v1/models', { authorization: 'Bearer wrong-key' }))
      expect(status).toBe(403)
    })
  })

  describe('not found', () => {
    it('unmatched route → 404 Cherry REST envelope (does not crash onError)', async () => {
      const { status, body } = await read(await get(app, '/no-such-route', {}))
      expect(status).toBe(404)
      // App-level fallback uses the Cherry REST dialect: { error: { code, message } }.
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.type).toBeUndefined()
    })
  })

  describe("Cherry endpoints use Cherry's own REST error envelope", () => {
    it('knowledge search missing `query` → 422 REST envelope (not OpenAI dialect)', async () => {
      const { status, body } = await read(await post(app, '/v1/knowledge-bases/search', {}))
      expect(status).toBe(422)
      // REST dialect: { error: { code, message } } — no OpenAI `type`, no Anthropic top-level `type`.
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.type).toBeUndefined()
      expect(body.type).toBeUndefined()
    })
  })

  describe('validation → dialect-specific error envelopes', () => {
    it('chat completion missing `model` → OpenAI 400 envelope', async () => {
      const { status, body } = await read(
        await post(app, '/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
      )
      expect(status).toBe(400)
      // OpenAI dialect: { error: { type, code } }, no top-level `type: 'error'`.
      expect(body.type).toBeUndefined()
      expect(body.error.type).toBe('invalid_request_error')
      expect(mockProcessMessage).not.toHaveBeenCalled()
    })

    it('responses missing `input` → OpenAI 400 envelope', async () => {
      const { status, body } = await read(await post(app, '/v1/responses', { model: 'openai:gpt-4' }))
      expect(status).toBe(400)
      expect(body.error.type).toBe('invalid_request_error')
    })

    it('messages missing `messages` → Anthropic 400 envelope', async () => {
      const { status, body } = await read(await post(app, '/v1/messages', { model: 'anthropic:claude' }))
      expect(status).toBe(400)
      // Anthropic dialect: { type: 'error', error: { type, message } }.
      expect(body.type).toBe('error')
      expect(body.error.type).toBe('invalid_request_error')
    })
  })

  describe('valid requests reach the handler', () => {
    it('valid chat completion passes validation and calls processMessage', async () => {
      const { status, body } = await read(
        await post(app, '/v1/chat/completions', { model: 'openai:gpt-4', messages: [{ role: 'user', content: 'hi' }] })
      )
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockProcessMessage).toHaveBeenCalledOnce()
    })

    it('GET /v1/models returns the model list', async () => {
      const { status, body } = await read(await get(app, '/v1/models'))
      expect(status).toBe(200)
      expect(body.object).toBe('list')
      expect(body.data).toHaveLength(1)
    })
  })

  describe('thrown provider errors → dialect status mapping (not a flat 500)', () => {
    const chat = { model: 'openai:gpt-4', messages: [{ role: 'user', content: 'hi' }] }

    it('chat: a 429 SerializedError → OpenAI 429 envelope, message preserved, extras dropped', async () => {
      mockProcessMessage.mockRejectedValueOnce({
        name: 'AI_APICallError',
        message: 'rate limited',
        stack: 'secret stack',
        statusCode: 429,
        url: 'https://provider/v1',
        requestBodyValues: { prompt: 'SECRET PROMPT' },
        responseBody: 'secret body'
      })
      const { status, body } = await read(await post(app, '/v1/chat/completions', chat))
      expect(status).toBe(429)
      expect(body.error.type).toBe('rate_limit_error')
      expect(body.error.message).toBe('rate limited')
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('secret stack')
      expect(serialized).not.toContain('SECRET PROMPT')
      expect(serialized).not.toContain('secret body')
      expect(serialized).not.toContain('https://provider/v1')
    })

    it('chat: a 403 SerializedError → OpenAI 403 forbidden envelope', async () => {
      mockProcessMessage.mockRejectedValueOnce({ name: 'Error', message: 'no access', stack: null, statusCode: 403 })
      const { status, body } = await read(await post(app, '/v1/chat/completions', chat))
      expect(status).toBe(403)
      expect(body.error.type).toBe('forbidden_error')
    })

    it('messages: a 401 SerializedError → Anthropic 401 authentication envelope', async () => {
      mockProcessMessage.mockRejectedValueOnce({ name: 'Error', message: 'bad key', stack: null, statusCode: 401 })
      const { status, body } = await read(
        await post(app, '/v1/messages', { model: 'anthropic:claude', messages: [{ role: 'user', content: 'hi' }] })
      )
      expect(status).toBe(401)
      expect(body.type).toBe('error') // Anthropic envelope
      expect(body.error.type).toBe('authentication_error')
      expect(body.error.message).toBe('bad key')
    })

    it('responses: an internal error with no status → 500 with the message gated out', async () => {
      mockProcessMessage.mockRejectedValueOnce(new Error('internal detail leak'))
      const { status, body } = await read(await post(app, '/v1/responses', { model: 'openai:gpt-4', input: 'hi' }))
      expect(status).toBe(500)
      expect(body.error.type).toBe('server_error')
      // NODE_ENV !== 'development' under test → internal messages are not leaked.
      expect(body.error.message).toBe('Internal server error')
    })
  })
})
