import { cors } from '@elysia/cors'
import { node } from '@elysia/node'
import { openapi } from '@elysia/openapi'
import { loggerService } from '@logger'
import { Elysia } from 'elysia'
import { v4 as uuidv4 } from 'uuid'
import * as z from 'zod'

import { gatewayErrorHandler } from './errors'
import { authGuard } from './middleware/auth'
import { chatRoutes } from './routes/chat'
import { knowledgeRoutes } from './routes/knowledge'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { responsesRoutes } from './routes/responses'

const logger = loggerService.withContext('ApiGateway')

/** Path under which OpenAPI docs (UI) and JSON spec (`${OPENAPI_PATH}/json`) are served. */
export const OPENAPI_PATH = '/openapi'

/**
 * Protected `/v1` API routes. The auth guard is `scoped` so it propagates to
 * every plugin mounted here, but NOT to the public app-level routes.
 */
const v1Routes = new Elysia({ prefix: '/v1' })
  .guard({
    as: 'scoped',
    beforeHandle: authGuard
  })
  .use(chatRoutes)
  .use(responsesRoutes)
  .use(modelsRoutes)
  .use(messagesRoutes)
  .use(knowledgeRoutes)

/**
 * Build the Elysia application (Node adapter). Assembles CORS, OpenAPI docs,
 * request logging + `X-Request-ID`, error handling, public info routes, and the
 * protected API route plugins.
 *
 * Exported for both the runtime server (`server.ts`) and the integration tests.
 */
export function buildApp() {
  const app = new Elysia({ adapter: node() })
    .use(
      cors({
        origin: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    )
    .use(
      openapi({
        path: OPENAPI_PATH,
        provider: 'scalar',
        mapJsonSchema: { zod: z.toJSONSchema },
        documentation: {
          info: {
            title: 'Cherry Studio API',
            version: '1.0.0',
            description:
              'OpenAI- and Anthropic-compatible HTTP API for Cherry Studio, plus Cherry-specific endpoints (models, knowledge bases)'
          }
        }
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
    // Global error handler — shapes errors into the OpenAI / Anthropic dialect
    // matching the request path (see ./errors).
    .onError(gatewayErrorHandler)
    // Public health check (no authentication).
    .get(
      '/health',
      () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      }),
      { detail: { tags: ['Health'], summary: 'Health check endpoint' } }
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
          knowledge_bases: 'GET /v1/knowledge-bases',
          knowledge_search: 'POST /v1/knowledge-bases/search'
        }
      }),
      { detail: { tags: ['General'], summary: 'API information' } }
    )
    .use(v1Routes)

  return app
}

export type ApiGatewayApp = ReturnType<typeof buildApp>
