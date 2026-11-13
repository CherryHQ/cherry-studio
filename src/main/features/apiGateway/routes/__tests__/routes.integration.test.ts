import type { Server } from 'node:http'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  lookupRuntimeCapability,
  registerRuntimeCapability,
  resetRuntimeCapabilities
} from '@main/ai/agentSession/agentRuntimeCapability'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { resolveApiGatewayRuntime } from '@main/ai/runtime/agentApiGateway'
import { createClaudeCodeWarmQuerySignature } from '@main/ai/runtime/claudeCode/ClaudeCodeWarmQueryManager'
import { BaseService } from '@main/core/lifecycle'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { ApiGatewayService } from '../../ApiGatewayService'
import { resolveGatewayRequest, type MessageConfig } from '../../gatewayRequest'

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
const {
  mockGetModels,
  mockEstimateAnthropicRequestTokens,
  mockIsInternalRequest,
  mockGetCredentialScope,
  scopedCredentials,
  realBoundary,
  mockPreferenceGet,
  mockProcessMessage,
  mockResolveGatewayModelAddress
} = vi.hoisted(() => ({
  realBoundary: {
    gateway: undefined as ApiGatewayService | undefined,
    runtime: undefined as AgentSessionRuntimeService | undefined
  },
  mockGetModels: vi.fn(async () => ({ object: 'list', data: [{ id: 'openai:gpt-4' }] })),
  mockEstimateAnthropicRequestTokens: vi.fn(async () => 42),
  mockIsInternalRequest: vi.fn((headers: Headers) => {
    const tokens = [headers.get('x-api-key'), headers.get('authorization'), headers.get('x-goog-api-key')]
    if (tokens.some((value) => value === 'internal-agent-key' || value === 'Bearer internal-agent-key')) return true
    return tokens.some((value) => scopedCredentials.has(value?.replace(/^Bearer /, '') ?? ''))
  }),
  mockGetCredentialScope: vi.fn((headers: Headers) =>
    scopedCredentials.get(
      headers.get('x-api-key') ??
        headers.get('authorization')?.replace(/^Bearer /, '') ??
        headers.get('x-goog-api-key') ??
        ''
    )
  ),
  scopedCredentials: new Map<string, { path: string; model: string }>(),
  mockPreferenceGet: vi.fn<(key: string) => unknown>(() => 'test-key'),
  mockProcessMessage: vi.fn<(config: unknown) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  ),
  mockResolveGatewayModelAddress: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  const overrides = {
    PreferenceService: { ...MockMainPreferenceServiceExport.preferenceService, get: mockPreferenceGet },
    AgentSessionRuntimeService: {
      isRuntimeLive: (id: string, type: 'claude-code' | 'pi') => realBoundary.runtime!.isRuntimeLive(id, type)
    },
    ApiGatewayService: {
      ensureInternalGateway: () => realBoundary.gateway!.ensureInternalGateway(),
      issueRuntimeCapability: (id: string, type: 'claude-code' | 'pi') =>
        realBoundary.gateway!.issueRuntimeCapability(id, type),
      getAgentSessionUsageHeaders: (id: string) => realBoundary.gateway!.getAgentSessionUsageHeaders(id),
      isInternalRequest: (headers: Headers) =>
        realBoundary.gateway ? realBoundary.gateway.isInternalRequest(headers) : mockIsInternalRequest(headers),
      getCredentialScope: (headers: Headers) =>
        realBoundary.gateway ? realBoundary.gateway.getCredentialScope(headers) : mockGetCredentialScope(headers),
      getAgentSessionId: (headers: Headers) => realBoundary.gateway?.getAgentSessionId(headers),
      resolveRuntimeCapability: (headers: Headers) => realBoundary.gateway?.resolveRuntimeCapability(headers)
    }
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
  getModels: mockGetModels,
  resolveGatewayModelAddress: mockResolveGatewayModelAddress
}))

vi.mock('../../tokens/estimateAnthropicRequestTokens', () => ({
  estimateAnthropicRequestTokens: mockEstimateAnthropicRequestTokens
}))

// Knowledge routes use the v2 KB service (pulled in by buildApp); stubbed so
// building the app stays hermetic (knowledge behaviour tested separately).
vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { list: vi.fn(async () => ({ items: [], total: 0, page: 1 })), getById: vi.fn() }
}))

import { buildApp } from '../../app'
import { CountTokensBodySchema, MessagesBodySchema } from '../schemas'

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
  let internalApp: ReturnType<typeof buildApp>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReturnValue('test-key')
    app = buildApp()
    internalApp = buildApp({ surface: 'internal' })
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

      expect(health.description).toBe('apiGateway.docs.operations.health::en-US')
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

  describe('Anthropic token counting', () => {
    it('resolves Cherry Cloud models as an internal request', async () => {
      const response = await post(
        internalApp,
        '/v1/messages/count_tokens',
        { model: 'cherryai-subscription:claude', messages: [{ role: 'user', content: 'hello' }] },
        { ...AUTH, 'x-api-key': 'internal-agent-key' }
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ input_tokens: 42 })
      expect(mockEstimateAnthropicRequestTokens).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'cherryai-subscription:claude' }),
        expect.any(AbortSignal),
        true
      )
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

  describe('Anthropic message content contract', () => {
    const contract = 'content is required and must be a string or an array of content blocks'

    for (const path of ['/v1/messages', '/v1/messages/count_tokens']) {
      it.each([0, 178])(`${path} rejects missing content at index %i before processing`, async (index) => {
        const messages = [...Array.from({ length: index }, () => ({ role: 'user', content: 'hi' })), { role: 'user' }]
        const { status, body } = await read(
          await post(app, path, { model: 'anthropic:claude', messages, stream: true })
        )
        expect(status).toBe(400)
        expect(body).toEqual({
          type: 'error',
          error: { type: 'invalid_request_error', message: `messages.${index}.content: ${contract}` }
        })
        expect(mockProcessMessage).not.toHaveBeenCalled()
        expect(mockEstimateAnthropicRequestTokens).not.toHaveBeenCalled()
      })

      it.each([null, false, 42, {}])(`${path} rejects content %j`, async (content) => {
        const { status, body } = await read(
          await post(app, path, { model: 'anthropic:claude', messages: [{ role: 'user', content }] })
        )
        expect(status).toBe(400)
        expect(body).toEqual({
          type: 'error',
          error: { type: 'invalid_request_error', message: `messages.0.content: ${contract}` }
        })
        expect(mockProcessMessage).not.toHaveBeenCalled()
        expect(mockEstimateAnthropicRequestTokens).not.toHaveBeenCalled()
      })

      it.each([
        { role: 'user', content: 'hi' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'user', content: '' },
        { role: 'user', content: [] },
        { role: 'system', content: 'Inline instructions' },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] }
      ])(`${path} accepts $role content $content`, async (message) => {
        const { status, body } = await read(await post(app, path, { model: 'anthropic:claude', messages: [message] }))
        expect(status).toBe(200)
        if (path === '/v1/messages') {
          expect(body).toEqual({ ok: true })
          expect(mockProcessMessage).toHaveBeenCalledOnce()
        } else {
          expect(body).toEqual({ input_tokens: 42 })
        }
      })

      it(`${path} preserves unknown message and block fields`, async () => {
        const messages = [
          { role: 'user', content: [{ type: 'text', text: 'hi', future_block: 42 }], future_message: true }
        ]
        const { status, body } = await read(await post(app, path, { model: 'anthropic:claude', messages }))
        expect(status).toBe(200)
        if (path === '/v1/messages') {
          expect(body).toEqual({ ok: true })
          expect(mockProcessMessage).toHaveBeenCalledWith(
            expect.objectContaining({ params: { model: 'anthropic:claude', messages } })
          )
        } else {
          expect(body).toEqual({ input_tokens: 42 })
          expect(mockEstimateAnthropicRequestTokens).toHaveBeenCalledWith(
            { model: 'anthropic:claude', messages },
            expect.any(AbortSignal),
            false
          )
        }
      })
    }

    it.each([MessagesBodySchema, CountTokensBodySchema])('rejects explicitly undefined content', (schema) => {
      const result = schema.safeParse({ model: 'anthropic:claude', messages: [{ role: 'user', content: undefined }] })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['messages', 0, 'content'])
        expect(result.error.issues[0].message).toBe(contract)
      }
    })

    it('keeps OpenAI tool calls without content valid', async () => {
      const { status, body } = await read(
        await post(app, '/v1/chat/completions', {
          model: 'openai:gpt-4',
          messages: [
            {
              role: 'assistant',
              tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
            }
          ]
        })
      )
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true })
      expect(mockProcessMessage).toHaveBeenCalledOnce()
    })

    it('keeps Responses function_call items valid', async () => {
      const { status, body } = await read(
        await post(app, '/v1/responses', {
          model: 'openai:gpt-4',
          input: [{ type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' }]
        })
      )
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true })
      expect(mockProcessMessage).toHaveBeenCalledOnce()
    })

    it('enforces the content contract through real buildApp HTTP sockets', async () => {
      let server: Server | undefined
      try {
        const baseUrl = await new Promise<string>((resolve, reject) => {
          app.listen({ port: 0, hostname: '127.0.0.1', gracefulShutdown: false }, (info) => {
            const handle = info as unknown as { raw: { node: { server: Server }; ready(): Promise<unknown> } }
            server = handle.raw.node.server
            void handle.raw.ready().then(() => {
              const address = server!.address()
              if (!address || typeof address === 'string') return reject(new Error('No gateway port'))
              resolve(`http://127.0.0.1:${address.port}`)
            }, reject)
          })
        })
        for (const path of ['/v1/messages', '/v1/messages/count_tokens']) {
          for (const index of [0, 178]) {
            const messages = [
              ...Array.from({ length: index }, () => ({ role: 'user', content: 'hi' })),
              { role: 'user' }
            ]
            const response = await fetch(`${baseUrl}${path}`, {
              method: 'POST',
              headers: AUTH,
              body: JSON.stringify({ model: 'anthropic:claude', messages }),
              signal: AbortSignal.timeout(5000)
            })
            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({
              type: 'error',
              error: { type: 'invalid_request_error', message: `messages.${index}.content: ${contract}` }
            })
            expect(mockProcessMessage).not.toHaveBeenCalled()
            expect(mockEstimateAnthropicRequestTokens).not.toHaveBeenCalled()
          }
        }
        for (const path of ['/v1/messages', '/v1/messages/count_tokens']) {
          for (const content of ['hi', [{ type: 'text', text: 'hi' }]]) {
            const response = await fetch(`${baseUrl}${path}`, {
              method: 'POST',
              headers: AUTH,
              body: JSON.stringify({ model: 'anthropic:claude', messages: [{ role: 'user', content }] }),
              signal: AbortSignal.timeout(5000)
            })
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual(path === '/v1/messages' ? { ok: true } : { input_tokens: 42 })
          }
        }
      } finally {
        if (server) {
          const listener = server
          await new Promise<void>((resolve, reject) => {
            listener.close((error) => (error ? reject(error) : resolve()))
            listener.closeAllConnections()
          })
        }
      }
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

    it('accepts Fast only from an internal consumer', async () => {
      await read(
        await post(
          internalApp,
          '/v1/messages',
          { model: 'anthropic:claude', messages: [{ role: 'user', content: 'hi' }] },
          {
            ...AUTH,
            'x-api-key': 'internal-agent-key',
            'x-cherry-fast-mode': 'true'
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

    it('countTokens: resolves Cherry Cloud models as an internal request', async () => {
      const response = await post(
        internalApp,
        '/v1beta/models/cherryai-subscription:gemini-2.5:countTokens',
        geminiBody,
        {
          ...AUTH,
          'x-api-key': 'internal-agent-key'
        }
      )

      expect(response.status).toBe(200)
      expect(mockResolveGatewayModelAddress).toHaveBeenCalledWith('cherryai-subscription:gemini-2.5', true)
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

  describe('LAN exposure (non-loopback peer)', () => {
    beforeEach(() => {
      mockPreferenceGet.mockImplementation((key) => (key === 'feature.api_gateway.host' ? '0.0.0.0' : 'test-key'))
    })

    // srvx surfaces the socket peer as `request.ip`; forge it to act as a LAN client.
    const fromLan = (request: Request): Request => {
      Object.defineProperty(request, 'ip', { value: '192.168.1.50', configurable: true })
      return request
    }
    const postFromLan = (path: string, body: unknown, headers: Record<string, string> = AUTH) =>
      app.handle(
        fromLan(new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
      )
    const getFromLan = (path: string, headers: Record<string, string> = AUTH) =>
      app.handle(fromLan(new Request(`http://localhost${path}`, { method: 'GET', headers })))

    it('blocks a LAN client from the generation routes', async () => {
      const { status, body } = await read(await postFromLan('/v1/chat/completions', { model: 'openai:gpt-4o' }))
      expect(status).toBe(403)
      expect(body.error).toContain('not reachable over the LAN')
    })

    it('blocks a LAN client from the MCP proxy and knowledge routes', async () => {
      expect((await read(await postFromLan('/v1/mcps/x/mcp', {}))).status).toBe(403)
      expect((await read(await getFromLan('/v1/knowledge-bases'))).status).toBe(403)
    })

    it('keeps loopback callers served after LAN access is revoked on a live listener', async () => {
      mockPreferenceGet.mockImplementation((key) => (key === 'feature.api_gateway.host' ? '127.0.0.1' : 'test-key'))

      expect((await getFromLan('/v1/models')).status).toBe(403)
      const localResponse = await post(app, '/v1/chat/completions', {
        model: 'openai:gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }]
      })
      expect(localResponse.status).toBe(200)
    })
  })
})

describe('internal consumer authorization', () => {
  it('accepts only internal keys on the internal listener and only the user key on the public one', async () => {
    const send = (app: ReturnType<typeof buildApp>, authorization: string) =>
      app.handle(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'openai:gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
        })
      )
    const internal = buildApp({ surface: 'internal' })
    const publicApp = buildApp()

    expect((await send(internal, 'Bearer internal-agent-key')).status).toBe(200)
    expect((await send(internal, 'Bearer test-key')).status).toBe(403)
    expect((await send(publicApp, 'Bearer test-key')).status).toBe(200)
    expect((await send(publicApp, 'Bearer internal-agent-key')).status).toBe(403)
  })

  it('accepts an internal key without the user-facing API key', async () => {
    const app = buildApp({ surface: 'internal' })
    const send = (authorization: string) =>
      app.handle(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'openai:gpt-4o', messages: [{ role: 'user', content: 'translate' }] })
        })
      )

    expect((await send('Bearer internal-agent-key')).status).toBe(200)
    expect((await send('Bearer unknown-key')).status).toBe(403)
  })

  it('limits a scoped credential to its path and model until revoked', async () => {
    const app = buildApp({ surface: 'internal' })
    const headers = { authorization: 'Bearer job-key', 'content-type': 'application/json' }
    const chat = (model: string) =>
      app.handle(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'translate' }] })
        })
      )
    scopedCredentials.set('job-key', { path: '/v1/chat/completions', model: 'openai:gpt-4o' })

    expect((await chat('openai:gpt-4o')).status).toBe(200)
    expect((await chat('openai:gpt-4.1')).status).toBe(403)
    expect((await app.handle(new Request('http://localhost/v1/models', { headers }))).status).toBe(403)
    const messages = { model: 'openai:gpt-4o', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }
    const post = (path: string, body: unknown) =>
      app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) }))
    expect((await post('/v1/messages', messages)).status).toBe(403)
    expect(
      (
        await post('/v1beta/models/openai:gpt-4o:generateContent', {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
        })
      ).status
    ).toBe(403)

    scopedCredentials.delete('job-key')
    expect((await chat('openai:gpt-4o')).status).toBe(403)
  })

  it('rejects an internal key presented only as a query parameter', async () => {
    const app = buildApp({ surface: 'internal' })
    const post = (path: string, body: unknown) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      )

    const gemini = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
    const chat = { model: 'openai:gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
    expect((await post('/v1beta/models/openai:gpt-4o:generateContent?key=internal-agent-key', gemini)).status).toBe(403)
    expect((await post('/v1/chat/completions?access_token=internal-agent-key', chat)).status).toBe(403)
  })
})

describe('client identity with real internal authentication', () => {
  let gateway: ApiGatewayService
  let runtime: AgentSessionRuntimeService
  beforeEach(() => {
    // Preserve the shared singleton guard while constructing this isolated service.
    const registry = BaseService as unknown as { instances: WeakSet<object> }
    const prior = registry.instances
    registry.instances = new WeakSet<object>()
    try {
      resetRuntimeCapabilities()
      gateway = new ApiGatewayService()
      runtime = new AgentSessionRuntimeService()
    } finally {
      registry.instances = prior
    }
    realBoundary.gateway = gateway
    realBoundary.runtime = runtime
    mockPreferenceGet.mockReturnValue('test-key')
    mockResolveGatewayModelAddress.mockReset()
    vi.spyOn(
      gateway as unknown as { ensureInternalListener(): Promise<string> },
      'ensureInternalListener'
    ).mockResolvedValue('http://127.0.0.1:23334')
    mockResolveGatewayModelAddress.mockResolvedValue({
      providerId: 'relay',
      apiModelId: 'claude',
      uniqueModelId: 'relay::claude',
      provider: {
        id: 'relay',
        settings: {},
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.test/v1', adapterFamily: 'anthropic' }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      },
      model: { id: 'relay::claude', modelId: 'claude', endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] }
    })
    mockProcessMessage.mockImplementation(async (config) => {
      const envelope = await resolveGatewayRequest(config as MessageConfig)
      return Response.json({ identity: envelope.clientIdentityHeaders ?? null })
    })
  })
  afterEach(() => {
    realBoundary.gateway = undefined
    realBoundary.runtime = undefined
    mockResolveGatewayModelAddress.mockReset()
    mockProcessMessage.mockReset().mockImplementation(async () => Response.json({ ok: true }))
    vi.restoreAllMocks()
  })

  const beginClaude = () =>
    runtime.beginTurn({
      sessionId: 'session',
      topicId: 'agent-session:session',
      agentId: 'agent',
      agentType: 'claude-code',
      modelId: 'relay::claude',
      assistantMessageId: 'answer'
    })
  const runtimeHeaders = (apiKey: string, token: string) =>
    new Headers({ 'x-api-key': apiKey, 'x-cherry-agent-runtime': token, 'x-cherry-agent-session-id': 'session' })

  it('rejects closed and Pi sessions but accepts the same token on Claude reopen', async () => {
    beginClaude()
    const route = await resolveApiGatewayRuntime('session', 'claude-code')
    const token = route.usageHeaders['x-cherry-agent-runtime']
    const headers = runtimeHeaders(route.apiKey, token)
    expect(gateway.resolveRuntimeCapability(headers)?.runtime).toBe('claude-code')
    runtime.markTurnTerminal('session', 'success')
    await runtime.closeSession('session')
    expect(gateway.resolveRuntimeCapability(headers)).toBeUndefined()
    beginClaude()
    expect(gateway.resolveRuntimeCapability(headers)?.runtime).toBe('claude-code')
    runtime.markTurnTerminal('session', 'success')
    runtime.beginTurn({
      sessionId: 'session',
      topicId: 'agent-session:session',
      agentId: 'agent',
      agentType: 'pi',
      modelId: 'relay::claude',
      assistantMessageId: 'pi-answer'
    })
    expect(gateway.resolveRuntimeCapability(headers)).toBeUndefined()
  })
  it('keeps warm-query hash inputs stable across park and revisit', async () => {
    beginClaude()
    await resolveApiGatewayRuntime('session', 'claude-code')
    runtime.markTurnTerminal('session', 'success')
    await runtime.closeSession('session')
    const parked = await resolveApiGatewayRuntime('session', 'claude-code')
    beginClaude()
    const revisited = await resolveApiGatewayRuntime('session', 'claude-code')
    const signature = (headers: Record<string, string>) =>
      createClaudeCodeWarmQuerySignature({
        env: {
          ANTHROPIC_CUSTOM_HEADERS: Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')
        }
      })
    expect(parked.usageHeaders['x-cherry-agent-runtime']).toBeTruthy()
    expect(signature(parked.usageHeaders)).toBe(signature(revisited.usageHeaders))
  })
  it('clears capabilities on gateway stop', async () => {
    beginClaude()
    const { apiKey } = await gateway.ensureInternalGateway()
    const token = gateway.issueRuntimeCapability('session', 'claude-code')!
    const headers = runtimeHeaders(apiKey, token)
    expect(gateway.resolveRuntimeCapability(headers)?.runtime).toBe('claude-code')
    await (gateway as unknown as { onStop(): Promise<void> }).onStop()
    expect(gateway.resolveRuntimeCapability(headers)).toBeUndefined()
    expect(lookupRuntimeCapability(token)).toBeUndefined()
    expect(gateway.issueRuntimeCapability('session', 'claude-code')).toBeUndefined()
  })
  it('fences replacement listener starts during and after shutdown', async () => {
    vi.mocked((gateway as any).ensureInternalListener).mockRestore()
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const stop = vi.fn(async () => {})
    const start = vi.spyOn(gateway as any, 'startInternalGateway').mockImplementation(async () => {
      await ready
      return { stop }
    })
    const starting = gateway.ensureInternalGateway()
    const rejected = expect(starting).rejects.toThrow('stopping')
    const stopping = (gateway as any).onStop()
    await expect(gateway.ensureInternalGateway()).rejects.toThrow('stopping')
    expect(gateway.issueRuntimeCapability('session', 'claude-code')).toBeUndefined()
    const stray = registerRuntimeCapability('session', 'claude-code')
    release()
    await rejected
    await stopping
    await expect(gateway.ensureInternalGateway()).rejects.toThrow('stopping')
    expect(start).toHaveBeenCalledTimes(1)
    expect(lookupRuntimeCapability(stray)).toBeUndefined()
  })
  it('clears the registry after listener-start failure', async () => {
    vi.mocked((gateway as any).ensureInternalListener).mockRestore()
    vi.spyOn(gateway as any, 'startInternalGateway').mockRejectedValue(new Error('fixture listen failure'))
    const token = registerRuntimeCapability('session', 'claude-code')
    await expect(gateway.ensureInternalGateway()).rejects.toThrow('fixture listen failure')
    expect(lookupRuntimeCapability(token)).toBeUndefined()
  })
  it.each(['credential', 'capability', 'openai'] as const)(
    'guards production identity wiring: %s',
    async (scenario) => {
      beginClaude()
      const route = await resolveApiGatewayRuntime('session', 'claude-code')
      const headers = runtimeHeaders(route.apiKey, route.usageHeaders['x-cherry-agent-runtime'])
      const value =
        scenario === 'credential'
          ? route.apiKey
          : scenario === 'capability'
            ? route.usageHeaders['x-cherry-agent-runtime']
            : 'cli'
      headers.set('content-type', 'application/json')
      headers.set('x-app', `cli/${value}`)
      const response = await post(
        buildApp({ surface: 'internal' }),
        scenario === 'openai' ? '/v1/chat/completions' : '/v1/messages',
        { model: 'relay:claude', max_tokens: 10, messages: [{ role: 'user', content: 'Hello' }] },
        Object.fromEntries(headers)
      )
      expect(response.status).toBe(200)
      expect((await response.json()).identity).toBeNull()
    }
  )
  for (const auth of ['x-api-key', 'authorization'] as const) {
    it.each([
      'claude-code',
      'other Claude session',
      'pi session',
      'scoped',
      'missing capability',
      'closed',
      'wrong session',
      'no session header',
      'forged capability',
      'public'
    ] as const)(`selects identity with ${auth}: %s`, async (scenario) => {
      const { apiKey } = await gateway.ensureInternalGateway()
      runtime.beginTurn({
        sessionId: 'session',
        topicId: 'agent-session:session',
        agentId: 'agent',
        agentType: 'claude-code',
        modelId: 'relay::claude',
        assistantMessageId: 'answer'
      })
      const capability = gateway.issueRuntimeCapability('session', 'claude-code')!
      const scoped = await gateway.createScopedCredential({ path: '/v1/messages', model: 'relay:claude' })
      const credential = scenario === 'scoped' ? scoped.apiKey : scenario === 'public' ? 'test-key' : apiKey
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [auth]: auth === 'authorization' ? `Bearer ${credential}` : credential,
        'x-cherry-agent-session-id': scenario === 'wrong session' ? 'another-session' : 'session',
        'user-agent': 'claude-cli/2.1.311',
        'x-app': 'cli',
        'x-client-app': 'claude-code'
      }
      if (scenario !== 'missing capability') {
        headers['x-cherry-agent-runtime'] = scenario === 'forged capability' ? 'forged' : capability
      }
      if (scenario === 'other Claude session') {
        runtime.beginTurn({
          sessionId: 'other-live-session',
          topicId: 'agent-session:other-live-session',
          agentId: 'agent',
          agentType: 'claude-code',
          modelId: 'relay::claude',
          assistantMessageId: 'other-answer'
        })
        headers['x-cherry-agent-runtime'] = gateway.issueRuntimeCapability('other-live-session', 'claude-code')!
      }
      if (scenario === 'no session header') delete headers['x-cherry-agent-session-id']
      if (scenario === 'pi session') {
        runtime.beginTurn({
          sessionId: 'pi-session',
          topicId: 'agent-session:pi-session',
          agentId: 'agent',
          agentType: 'pi',
          modelId: 'relay::claude',
          assistantMessageId: 'pi-answer'
        })
        headers['x-cherry-agent-session-id'] = 'pi-session'
        delete headers['x-cherry-agent-runtime']
        const pi = await resolveApiGatewayRuntime('pi-session', 'pi')
        Object.assign(headers, pi.usageHeaders)
      }
      if (scenario === 'closed') await runtime.closeSession('session')
      const response = await post(
        buildApp({ surface: scenario === 'public' ? 'public' : 'internal' }),
        '/v1/messages',
        { model: 'relay:claude', max_tokens: 10, messages: [{ role: 'user', content: 'Hello' }] },
        headers
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      if (scenario === 'claude-code')
        expect(body.identity).toEqual({
          'user-agent': 'claude-cli/2.1.311',
          'x-app': 'cli',
          'x-client-app': 'claude-code'
        })
      else expect(body.identity).toBeNull()
      scoped.dispose()
    })
  }
})
