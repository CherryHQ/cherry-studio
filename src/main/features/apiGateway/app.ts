import { bearer } from '@elysia/bearer'
import { cors } from '@elysia/cors'
import { node } from '@elysia/node'
import { Elysia } from 'elysia'
import { v4 as uuidv4 } from 'uuid'

import { loggerService } from '@logger'
import { DataApiError } from '@shared/data/api/errors'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

import { gatewayErrorHandler } from './errors'
import { McpSessionStore } from './McpSessionStore'
import { authorizeApiRequest } from './middleware/auth'
import {
  buildOpenApiDocument,
  DOC_DESCRIPTIONS,
  DOC_TAGS,
  OPENAPI_PATH,
  renderDocsPage,
  resolveDocsLanguage
} from './openapiDocs'
import { chatRoutes } from './routes/chat'
import { geminiRoutes } from './routes/gemini'
import { knowledgeRoutes } from './routes/knowledge'
import { createMcpRoutes } from './routes/mcp'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { responsesRoutes } from './routes/responses'

const logger = loggerService.withContext('ApiGateway')

/**
 * Protected `/v1` API routes. The auth guard is `scoped` so it propagates to
 * every plugin mounted here, but NOT to the public app-level routes. Errors are
 * shaped by the single root `gatewayErrorHandler` (see `buildApp`), which selects
 * the dialect by path.
 */
const buildV1Routes = (mcpSessions: McpSessionStore) =>
  new Elysia({ prefix: '/v1' })
    // `@elysia/bearer` derives `bearer` from `Authorization: Bearer …` / `?access_token`.
    .use(bearer())
    .guard({
      as: 'scoped',
      beforeHandle: ({ bearer, headers, set }) => {
        const failure = authorizeApiRequest(headers['x-api-key'], bearer)
        if (!failure) return undefined
        set.status = failure.status
        return { error: failure.error }
      }
    })
    .use(messagesRoutes)
    .use(chatRoutes)
    .use(responsesRoutes)
    .use(modelsRoutes)
    .use(knowledgeRoutes)
    .use(createMcpRoutes(mcpSessions))

/** Where the gateway listens; used to render an absolute OpenAPI server URL. */
interface BuildAppOptions {
  host?: string
  port?: number
  /**
   * Live MCP sessions. `server.ts` passes the store it owns so gateway shutdown closes
   * them; omitting it (tests, `buildApp()` with no args) gets a throwaway store.
   */
  mcpSessions?: McpSessionStore
}

/**
 * Build the Elysia application (Node adapter). Assembles CORS, OpenAPI docs,
 * request logging + `X-Request-ID`, error handling, public info routes, and the
 * protected API route plugins.
 *
 * `host`/`port` default to the `feature.api_gateway.*` preference defaults so the
 * integration tests can call `buildApp()` with no arguments; `server.ts` passes
 * the live preference values. They populate the OpenAPI `servers` URL so Scalar
 * renders copyable absolute curl examples (e.g. `curl http://127.0.0.1:23333/health`)
 * instead of relative paths.
 *
 * Exported for both the runtime server (`server.ts`) and the integration tests.
 */
export function buildApp({
  host = '127.0.0.1',
  port = 23333,
  mcpSessions = new McpSessionStore()
}: BuildAppOptions = {}) {
  const app = new Elysia({ adapter: node() })
    .use(
      cors({
        origin: true,
        // Reflect the client's requested headers (the @elysia/cors default for
        // `allowedHeaders: true`) rather than a fixed allowlist. Browser SDK clients
        // send dialect-specific headers — Anthropic's `x-api-key` / `anthropic-version`
        // / `anthropic-beta`, OpenAI's `Authorization` / `openai-organization`, etc. —
        // and a static list silently fails their preflight. CORS is not the auth
        // boundary here (the API key is; non-browser clients ignore CORS entirely), so
        // reflecting the requested headers is the correct, maintenance-free choice.
        allowedHeaders: true,
        // Must be an explicit list, not the default `true`. That default reflects the
        // *request's* header names, and an `initialize` request cannot carry `mcp-session-id`
        // yet — so a browser client would be unable to read the id the server just issued,
        // would send every later request without it, and would orphan the session.
        exposeHeaders: ['mcp-session-id', 'x-request-id'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    )
    // Stamp a request id and record the start time for latency logging.
    .onRequest(({ set }) => {
      set.headers['x-request-id'] = uuidv4()
    })
    .derive(() => ({ requestStartedAt: Date.now() }))
    .onAfterResponse(({ request, path, set, requestStartedAt }) => {
      const durationMs = typeof requestStartedAt === 'number' ? Date.now() - requestStartedAt : undefined
      logger.info('API request completed', {
        method: request.method,
        path,
        statusCode: set.status,
        durationMs
      })
    })
    // Single root error handler — shapes every error into the dialect matching
    // the request path (see ./errors). `.error()` registers the v2 error type so
    // the handler's `code` is typed to include `'DATA_API'`.
    .error({ DATA_API: DataApiError })
    .onError(gatewayErrorHandler)
    // OpenAPI spec, generated from the live route table and localized per
    // request — `?lang=` picks the language, defaulting to the app's own. Hidden
    // from the spec it serves: the docs routes are not part of the API.
    .get(
      `${OPENAPI_PATH}/json`,
      ({ request }) =>
        buildOpenApiDocument(app, resolveDocsLanguage(new URL(request.url)), gatewayClientOrigin(host, port)),
      { detail: { hide: true } }
    )
    // OpenAPI docs UI (Scalar), pointed at the spec for the same language.
    .get(
      OPENAPI_PATH,
      ({ request }) => {
        const url = new URL(request.url)
        const lang = resolveDocsLanguage(url)
        const html = renderDocsPage(lang, `${url.origin}${OPENAPI_PATH}/json?lang=${lang}`)
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf8' } })
      },
      { detail: { hide: true } }
    )
    // Public health check (no authentication).
    .get(
      '/health',
      () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      }),
      { detail: { tags: [DOC_TAGS.cherry], summary: 'Health', description: DOC_DESCRIPTIONS.health } }
    )
    // Public API information.
    .get(
      '/',
      () => ({
        name: 'Cherry Studio API',
        version: '1.0.0',
        endpoints: {
          health: 'GET /health',
          docs: `GET ${OPENAPI_PATH}`,
          docs_json: `GET ${OPENAPI_PATH}/json`,
          chat_completions: 'POST /v1/chat/completions',
          messages: 'POST /v1/messages',
          generate_content: 'POST /v1beta/models/{model}:generateContent',
          knowledge_bases: 'GET /v1/knowledge-bases',
          knowledge_search: 'POST /v1/knowledge-bases/search',
          mcp_servers: 'GET /v1/mcps',
          mcp_proxy: 'POST /v1/mcps/{server_id}/mcp'
        }
      }),
      { detail: { tags: [DOC_TAGS.cherry], summary: 'API Info', description: DOC_DESCRIPTIONS.info } }
    )
    // Gemini routes carry their own self-contained (`local`) auth guard and are
    // mounted BEFORE `v1Routes` on purpose: `v1Routes`' `scoped` guard exports to
    // the app scope and would otherwise intercept `/v1beta` requests (its guard
    // reads only `x-api-key`/Bearer, so it would 401 the Gemini `x-goog-api-key` /
    // `?key=` credentials). Registering `/v1beta` first keeps it out of that guard's
    // reach; the `local` gemini guard does not leak back onto `/v1`.
    .use(geminiRoutes)
    .use(buildV1Routes(mcpSessions))

  return app
}

export type ApiGatewayApp = ReturnType<typeof buildApp>
