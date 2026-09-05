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
const { mockPreferenceGet, mockProcessMessage, mockGetModels, mockIsInternalRequestToken } = vi.hoisted(() => ({
  mockPreferenceGet: vi.fn<(key: string) => unknown>(() => 'test-key'),
  mockProcessMessage: vi.fn<(config: unknown) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  ),
  mockGetModels: vi.fn(async () => ({ object: 'list', data: [{ id: 'openai:gpt-4' }] })),
  mockIsInternalRequestToken: vi.fn((candidate: string | undefined) => candidate === 'internal-request-token')
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    PreferenceService: { get: mockPreferenceGet },
    ApiGatewayService: { isInternalRequestToken: mockIsInternalRequestToken }
  }
  return mockApplicationFactory(overrides)
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

// Route `detail.description` fields hold i18n *keys*; openapiDocs.ts resolves them
// per request via `t()`. Stub `t` as `key::lang` (rather than a pure passthrough) so
// the docs tests below can assert the requested language actually reached translation
// — and so a key that never went through `t()` is visibly missing its `::lang` suffix
// — without needing the real catalog. `getAppLanguage`/`SUPPORTED_LANGUAGES` back the
// docs' default language + language-switcher list.
vi.mock('@main/i18n', () => ({
  t: (key: string, _params?: unknown, lang?: string) => (lang ? `${key}::${lang}` : key),
  getAppLanguage: () => 'en-US',
  SUPPORTED_LANGUAGES: ['en-US', 'zh-CN']
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

    it('OpenAPI spec advertises an absolute server URL from host/port', async () => {
      // Scalar renders curl examples against `servers[0].url`; an absolute URL
      // keeps the health-check example copyable (`curl http://.../health`)
      // instead of a bare relative path (`curl /health`).
      const { body } = await read(await get(app, '/openapi/json', {}))
      expect(body.servers).toEqual([{ url: 'http://127.0.0.1:23333' }])

      // A wildcard bind is not a dialable target, so the advertised URL must be the
      // loopback the curl example can actually reach.
      const custom = await read(await get(buildApp({ host: '0.0.0.0', port: 8080 }), '/openapi/json', {}))
      expect(custom.body.servers).toEqual([{ url: 'http://127.0.0.1:8080' }])
    })
  })

  describe('OpenAPI docs — per-language translation + switcher', () => {
    it('GET /openapi/json (no ?lang=) translates against the app language', async () => {
      const { status, body } = await read(await get(app, '/openapi/json', {}))
      expect(status).toBe(200)
      expect(body.info.description).toBe('apiGateway.docs.description::en-US')
      const health = body.paths['/health'].get
      expect(health.tags).toEqual(['Cherry Studio'])
      expect(health.summary).toBe('Health')
      expect(health.description).toBe('apiGateway.docs.operations.health::en-US')
    })

    it('groups endpoints by the upstream API they are compatible with, keeping canonical names', async () => {
      const { body } = await read(await get(app, '/openapi/json', {}))
      expect(body.tags.map((tag: { name: string }) => tag.name)).toEqual([
        'OpenAI API',
        'Anthropic API',
        'Gemini API',
        'Cherry Studio'
      ])
      // Tag names and operation summaries are upstream identifiers: never translated,
      // so generated clients keep stable module/method names. Only prose is localized.
      expect(body.tags[0].description).toBe('apiGateway.docs.tags.openai::en-US')
      expect(body.paths['/v1/chat/completions'].post.tags).toEqual(['OpenAI API'])
      expect(body.paths['/v1/chat/completions'].post.summary).toBe('Chat Completions')
      expect(body.paths['/v1/messages/'].post.tags).toEqual(['Anthropic API'])
      expect(body.paths['/v1/messages/'].post.summary).toBe('Messages')
    })

    it('routes every documented operation through translation (no raw i18n key survives)', async () => {
      const { body } = await read(await get(app, '/openapi/json?lang=zh-CN', {}))
      const operations = Object.values<any>(body.paths).flatMap((pathItem) => Object.values<any>(pathItem))
      expect(operations.length).toBeGreaterThan(0)
      for (const operation of operations) {
        // The stubbed `t()` appends `::lang`; a description a route declared but
        // openapiDocs.ts never resolved would show up here as a bare key.
        expect(operation.description).toMatch(/^apiGateway\.docs\.operations\.[a-z_]+::zh-CN$/)
      }
    })

    it('keeps the docs routes themselves out of the spec', async () => {
      const { body } = await read(await get(app, '/openapi/json', {}))
      expect(Object.keys(body.paths)).not.toContain('/openapi')
      expect(Object.keys(body.paths)).not.toContain('/openapi/json')
    })

    it('GET /openapi/json?lang=zh-CN translates against the requested language', async () => {
      const { body } = await read(await get(app, '/openapi/json?lang=zh-CN', {}))
      expect(body.info.description).toBe('apiGateway.docs.description::zh-CN')
      expect(body.paths['/health'].get.description).toBe('apiGateway.docs.operations.health::zh-CN')
    })

    it('GET /openapi/json?lang=not-a-real-language falls back to the app language', async () => {
      const { body } = await read(await get(app, '/openapi/json?lang=not-a-real-language', {}))
      expect(body.info.description).toBe('apiGateway.docs.description::en-US')
    })

    it('GET /openapi renders the description through t() (not a raw key) and points Scalar at the translated spec', async () => {
      const res = await get(app, '/openapi', {})
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      const html = await res.text()
      // The mocked `t()` embeds `::lang` on every call — the plain (untranslated) key never
      // appears without it, so this proves the <meta description> went through translation.
      expect(html).toContain('apiGateway.docs.description::en-US')
      expect(html).not.toContain('apiGateway.docs.description"')

      const configMatch = html.match(/data-configuration='(.+?)'/)
      expect(configMatch).toBeTruthy()
      const config = JSON.parse(configMatch![1])
      expect(config.url).toBe('http://localhost/openapi/json?lang=en-US')
      expect(config.localization).toEqual({ locale: 'en' })
    })

    it('pins the Scalar bundle and turns off its third-party "Ask AI" agent', async () => {
      const html = await (await get(app, '/openapi', {})).text()
      const config = JSON.parse(html.match(/data-configuration='(.+?)'/)![1])
      // Unpinned, an upstream release can change defaults (1.63.0 enabled Ask AI on
      // localhost) or break the toolbar the language switcher is inserted into.
      expect(config.cdn).toMatch(/@scalar\/api-reference@\d+\.\d+\.\d+\//)
      expect(config.version).toMatch(/^\d+\.\d+\.\d+$/)
      // Ask AI uploads the OpenAPI document to api.scalar.com — off unless a user
      // has been asked to accept that.
      expect(config.agent).toEqual({ disabled: true })
    })

    it('GET /openapi renders a language dropdown offering every supported language, defaulting to the app language', async () => {
      const html = await (await get(app, '/openapi', {})).text()
      expect(html).toContain(`<option value="en-US" selected>English</option>`)
      expect(html).toContain(`<option value="zh-CN">中文</option>`)
    })

    it('GET /openapi?lang=zh-CN renders Scalar chrome + the dropdown in the requested language', async () => {
      const html = await (await get(app, '/openapi?lang=zh-CN', {})).text()
      const config = JSON.parse(html.match(/data-configuration='(.+?)'/)![1])
      expect(config.url).toBe('http://localhost/openapi/json?lang=zh-CN')
      expect(config.localization).toEqual({ locale: 'zh-CN' })
      expect(html).toContain(`<option value="zh-CN" selected>中文</option>`)
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

    it('ignores the internal Fast header from a public API-key client', async () => {
      await read(
        await post(
          app,
          '/v1/messages',
          { model: 'anthropic:claude', messages: [{ role: 'user', content: 'hi' }] },
          { ...AUTH, 'x-cherry-fast-mode': 'true' }
        )
      )

      expect(mockProcessMessage).toHaveBeenLastCalledWith(expect.objectContaining({ fastMode: false }))
    })

    it('accepts Fast only with the process-local internal request token', async () => {
      await read(
        await post(
          app,
          '/v1/messages',
          { model: 'anthropic:claude', messages: [{ role: 'user', content: 'hi' }] },
          {
            ...AUTH,
            'x-cherry-fast-mode': 'true',
            'x-cherry-internal-request-token': 'internal-request-token'
          }
        )
      )

      expect(mockProcessMessage).toHaveBeenLastCalledWith(expect.objectContaining({ fastMode: true }))
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

    it('messages: an upstream 401 reports the requested route without attributing the failing fallback', async () => {
      mockProcessMessage.mockRejectedValueOnce({
        name: 'Error',
        message: 'User not found',
        stack: null,
        statusCode: 401,
        gatewayErrorKind: 'upstream_provider',
        requestedProviderId: 'openrouter',
        requestedModelId: 'deepseek/deepseek-v4-flash-0731',
        requestBodyValues: { messages: ['SECRET REQUEST'] }
      })
      const { status, body } = await read(
        await post(app, '/v1/messages', {
          model: 'openrouter:deepseek/deepseek-v4-flash-0731',
          messages: [{ role: 'user', content: 'hi' }]
        })
      )
      expect(status).toBe(401)
      expect(body.type).toBe('error') // Anthropic envelope
      expect(body.error.type).toBe('authentication_error')
      expect(body.error.message).toBe(
        'Gateway request for "openrouter:deepseek/deepseek-v4-flash-0731" received an upstream authentication failure. Check the requested route, any configured fallback, and account access.'
      )
      expect(JSON.stringify(body)).not.toContain('User not found')
      expect(JSON.stringify(body)).not.toContain('SECRET REQUEST')
    })

    it('messages: a non-retryable provider 400 → Anthropic 400 invalid-request envelope', async () => {
      mockProcessMessage.mockRejectedValueOnce({
        name: 'AI_APICallError',
        message: 'Maximum context length exceeded',
        stack: null,
        statusCode: 400,
        isRetryable: false
      })
      const { status, body } = await read(
        await post(app, '/v1/messages', { model: 'anthropic:claude', messages: [{ role: 'user', content: 'hi' }] })
      )
      expect(status).toBe(400)
      expect(body.type).toBe('error')
      expect(body.error.type).toBe('invalid_request_error')
      expect(body.error.message).toBe('Maximum context length exceeded')
    })

    it('chat: an upstream 503 reports the requested route without attributing the failing fallback', async () => {
      mockProcessMessage.mockRejectedValueOnce({
        name: 'AI_APICallError',
        message: 'Service unavailable',
        stack: null,
        statusCode: 503,
        gatewayErrorKind: 'upstream_provider',
        requestedProviderId: 'openrouter',
        requestedModelId: 'deepseek/deepseek-v4-flash-0731'
      })
      const { status, body } = await read(
        await post(app, '/v1/chat/completions', {
          model: 'openrouter:deepseek/deepseek-v4-flash-0731',
          messages: [{ role: 'user', content: 'hi' }]
        })
      )

      expect(status).toBe(503)
      expect(body.error.type).toBe('server_error')
      expect(body.error.message).toBe(
        'Gateway request for "openrouter:deepseek/deepseek-v4-flash-0731" failed upstream (HTTP 503). Check the requested route, any configured fallback, and model access.'
      )
      expect(JSON.stringify(body)).not.toContain('Service unavailable')
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

  describe('Gemini (/v1beta) routes', () => {
    const geminiBody = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
    const GOOG_AUTH = { 'content-type': 'application/json', 'x-goog-api-key': 'test-key' }

    it('generateContent: model + non-streaming derived from the URL, routed with gemini formats', async () => {
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', geminiBody)
      )
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockProcessMessage).toHaveBeenCalledOnce()
      expect(mockProcessMessage.mock.calls[0][0]).toMatchObject({
        modelString: 'deepseek:deepseek-chat',
        streaming: false,
        inputFormat: 'gemini',
        outputFormat: 'gemini'
      })
    })

    it('streamGenerateContent: preserves a slashed apiModelId and sets streaming=true', async () => {
      // The gateway model addressing "providerId:apiModelId" can contain both a
      // colon and a slash (aggregator ids like `agent/deepseek-v4-flash`); the
      // wildcard route must keep the whole model intact and split off only the method.
      await read(await post(app, '/v1beta/models/618d8838:agent/deepseek-v4-flash:streamGenerateContent', geminiBody))
      expect(mockProcessMessage.mock.calls[0][0]).toMatchObject({
        modelString: '618d8838:agent/deepseek-v4-flash',
        streaming: true,
        inputFormat: 'gemini'
      })
    })

    it('normalizes an Antigravity custom model path to the gateway model address', async () => {
      await read(
        await post(app, '/v1beta/models/provider-a/models/models/gemini-flash:streamGenerateContent', geminiBody)
      )
      expect(mockProcessMessage.mock.calls[0][0]).toMatchObject({
        modelString: 'provider-a:models/gemini-flash',
        streaming: true,
        inputFormat: 'gemini'
      })
    })

    it('strips the gemini-cli sentinel suffix off the model before routing', async () => {
      // Cherry hands gemini-cli the address with an `@cherry` suffix so its model
      // normalization can't rewrite names ending in "flash"; the route must strip it.
      await read(
        await post(app, '/v1beta/models/618d8838:agent/deepseek-v4-flash@cherry:streamGenerateContent', geminiBody)
      )
      expect(mockProcessMessage.mock.calls[0][0]).toMatchObject({
        modelString: '618d8838:agent/deepseek-v4-flash',
        streaming: true
      })
    })

    it('routes a sentinel-suffixed model whose apiModelId itself contains "/models/"', async () => {
      // Fireworks ids are `accounts/fireworks/models/<name>` (16 of them in the registry), so
      // deciding the address protocol by looking for "/models/" misreads them as Antigravity
      // paths and rejects a perfectly valid gemini-cli request.
      await read(
        await post(
          app,
          '/v1beta/models/fireworks:accounts/fireworks/models/deepseek-v4-flash@cherry:streamGenerateContent',
          geminiBody
        )
      )
      expect(mockProcessMessage.mock.calls[0][0]).toMatchObject({
        modelString: 'fireworks:accounts/fireworks/models/deepseek-v4-flash',
        streaming: true
      })
    })

    it('rejects a model still ending in the reserved @cherry suffix after one strip → 400', async () => {
      // The sentinel is reserved: the route strips exactly one trailing `@cherry`, so a model that
      // STILL ends in it (a real id ending in the reserved marker, or a doubled sentinel) is
      // ambiguous and never advertised by GET /models — reject rather than route to the wrong id.
      const { status, body } = await read(
        await post(app, '/v1beta/models/weird:model@cherry@cherry:generateContent', geminiBody)
      )
      expect(status).toBe(400)
      expect(body.error.status).toBe('INVALID_ARGUMENT')
      expect(mockProcessMessage).not.toHaveBeenCalled()
    })

    it('countTokens: returns a local estimate without calling processMessage', async () => {
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:countTokens', geminiBody)
      )
      expect(status).toBe(200)
      expect(typeof body.totalTokens).toBe('number')
      expect(body.totalTokens).toBeGreaterThan(0)
      expect(mockProcessMessage).not.toHaveBeenCalled()
    })

    // Media is now counted (converted → shared walker, or the provider's remote count) rather
    // than rejected — the estimate reflects what the provider actually receives.
    it.each([
      ['inlineData', { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
      ['fileData', { fileData: { mimeType: 'application/pdf', fileUri: 'gs://bucket/f.pdf' } }]
    ])('countTokens with %s media → 200 with a token estimate', async (_kind, mediaPart) => {
      const mediaBody = { contents: [{ role: 'user', parts: [mediaPart] }] }
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:countTokens', mediaBody)
      )
      expect(status).toBe(200)
      expect(typeof body.totalTokens).toBe('number')
      expect(mockProcessMessage).not.toHaveBeenCalled()
    })

    it('unsupported method → 400 Google INVALID_ARGUMENT envelope', async () => {
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:embedContent', geminiBody)
      )
      expect(status).toBe(400)
      expect(body.error.status).toBe('INVALID_ARGUMENT')
      expect(mockProcessMessage).not.toHaveBeenCalled()
    })

    it('rejects unauthenticated /v1beta requests with a 401 Google UNAUTHENTICATED envelope', async () => {
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', geminiBody, {
          'content-type': 'application/json'
        })
      )
      expect(status).toBe(401)
      // Auth short-circuits before the handler, but must still speak the Google dialect.
      expect(body.error.code).toBe(401)
      expect(body.error.status).toBe('UNAUTHENTICATED')
      expect(typeof body.error.message).toBe('string')
      // Not the OpenAI/Anthropic shapes.
      expect(body.type).toBeUndefined()
      expect(body.error.type).toBeUndefined()
    })

    it('rejects an invalid /v1beta key with a 403 Google PERMISSION_DENIED envelope', async () => {
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', geminiBody, {
          'content-type': 'application/json',
          'x-goog-api-key': 'wrong-key'
        })
      )
      expect(status).toBe(403)
      expect(body.error.code).toBe(403)
      expect(body.error.status).toBe('PERMISSION_DENIED')
    })

    it('authenticates via the x-goog-api-key header', async () => {
      const { status } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', geminiBody, GOOG_AUTH)
      )
      expect(status).toBe(200)
    })

    it('authenticates via the ?key= query param', async () => {
      const { status } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent?key=test-key', geminiBody, {
          'content-type': 'application/json'
        })
      )
      expect(status).toBe(200)
    })

    it('missing `contents` → 400 Google envelope (not OpenAI/Anthropic dialect)', async () => {
      const { status, body } = await read(await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', {}))
      expect(status).toBe(400)
      expect(body.error.status).toBe('INVALID_ARGUMENT')
      expect(body.error.code).toBe(400)
      // Not the OpenAI/Anthropic shapes.
      expect(body.type).toBeUndefined()
      expect(body.error.type).toBeUndefined()
    })

    it('a thrown 429 provider error → Google RESOURCE_EXHAUSTED envelope', async () => {
      mockProcessMessage.mockRejectedValueOnce({ name: 'Error', message: 'rate limited', stack: null, statusCode: 429 })
      const { status, body } = await read(
        await post(app, '/v1beta/models/deepseek:deepseek-chat:generateContent', geminiBody)
      )
      expect(status).toBe(429)
      expect(body.error.status).toBe('RESOURCE_EXHAUSTED')
      expect(body.error.message).toBe('rate limited')
    })
  })
})
