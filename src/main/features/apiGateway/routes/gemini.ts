import { bearer } from '@elysia/bearer'
import { isReservedGeminiGatewayModelId, stripGeminiGatewayModelSuffix } from '@shared/utils/apiGateway'
import { Elysia } from 'elysia'

import type { InputParamsMap } from '../adapters'
import { googleEnvelope } from '../errors'
import { authorizeApiRequest } from '../middleware/auth'
import { processMessage } from '../proxyStream'
import { estimateGeminiRequestTokens } from '../tokens/estimateGeminiRequestTokens'
import { GeminiGenerateContentBodySchema } from './schemas'

/** Generation methods the gateway serves under `/v1beta/models/{model}:{method}`. */
const GENERATE_METHODS = new Set(['generateContent', 'streamGenerateContent'])

/**
 * Split the wildcard path segment `providerId:apiModelId:method` into its model
 * (`providerId:apiModelId`, kept intact for `processMessage`) and the trailing
 * method. The model itself contains a colon, so the method is taken off the LAST
 * colon. Returns `null` when there is no method separator. The model may carry the
 * gemini-cli sentinel suffix (see `GEMINI_GATEWAY_MODEL_SUFFIX`) — strip it here so
 * routing sees the real gateway address.
 */
function parseModelMethod(raw: string): { model: string; method: string } | null {
  const lastColon = raw.lastIndexOf(':')
  if (lastColon <= 0 || lastColon >= raw.length - 1) return null
  return { model: stripGeminiGatewayModelSuffix(raw.slice(0, lastColon)), method: raw.slice(lastColon + 1) }
}

/** Google `invalid_argument` (400) envelope for in-handler request errors. */
const invalidArgument = (message: string) => ({
  error: { code: 400, message, status: 'INVALID_ARGUMENT' }
})

/**
 * Google Generative Language routes (`/v1beta`).
 *
 * Self-contained: the auth guard is `local` (it does NOT export to the app scope,
 * so it never leaks onto `/v1`), and Gemini clients present the key via
 * `x-goog-api-key` or the `?key=` query param (`x-api-key` / Bearer are still
 * accepted for parity). See the mount-order note in `app.ts` for why this group is
 * registered before `v1Routes`.
 *
 * `POST /v1beta/models/{model}:generateContent` (JSON) and
 * `:streamGenerateContent` (SSE with `?alt=sse`) both stream through
 * `AiStreamManager`; the model and the streaming flag come from the URL, not the
 * body. `:countTokens` estimates the converted representation (provider remote count when
 * reachable, else the shared local walker incl. media). Errors are shaped into the Google
 * envelope by the app's root `onError` (path-based → `googleErrorHandler`).
 */
export const geminiRoutes = new Elysia({ prefix: '/v1beta' })
  .use(bearer())
  .guard({
    as: 'local',
    beforeHandle: ({ bearer, headers, query, set }) => {
      const googleApiKey = headers['x-goog-api-key'] ?? (typeof query?.key === 'string' ? query.key : undefined)
      const failure = authorizeApiRequest(headers['x-api-key'], bearer, googleApiKey)
      if (!failure) return undefined
      // Short-circuit responses bypass the root `onError`, so shape the Google
      // envelope here directly (401 → UNAUTHENTICATED, 403 → PERMISSION_DENIED)
      // to honour the `/v1beta` dialect's error contract.
      set.status = failure.status
      return googleEnvelope(failure.status, failure.error)
    }
  })
  .post(
    '/models/*',
    async ({ params, body, request, status }) => {
      const parsed = parseModelMethod(params['*'])
      if (!parsed) {
        return status(400, invalidArgument('Invalid model path. Expected "models/{model}:{method}".'))
      }
      const { model, method } = parsed

      // The sentinel suffix is reserved: `parseModelMethod` strips one trailing `@cherry`, so a
      // model that STILL ends in it addresses a real id ending in the reserved suffix — which is
      // ambiguous with the sentinel and never advertised by `GET /models`. Reject rather than route.
      if (isReservedGeminiGatewayModelId(model)) {
        return status(400, invalidArgument(`Model id "${model}" is reserved and not routable through the gateway.`))
      }

      if (method === 'countTokens') {
        return { totalTokens: await estimateGeminiRequestTokens(body as InputParamsMap['gemini'], model) }
      }
      if (!GENERATE_METHODS.has(method)) {
        return status(400, invalidArgument(`Unsupported method: "${method}".`))
      }

      return processMessage({
        params: body,
        modelString: model,
        streaming: method === 'streamGenerateContent',
        inputFormat: 'gemini',
        outputFormat: 'gemini',
        signal: request.signal
      })
    },
    {
      body: GeminiGenerateContentBodySchema,
      detail: { tags: ['Gemini'], summary: 'Generate content (Gemini dialect)' }
    }
  )
