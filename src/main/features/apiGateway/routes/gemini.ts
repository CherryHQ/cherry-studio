import { bearer } from '@elysia/bearer'
import {
  formatGatewayModelId,
  parseAntigravityGatewayModelPath,
  parseGeminiGatewayModelId
} from '@shared/utils/apiGateway'
import { Elysia } from 'elysia'

import type { InputParamsMap } from '../adapters'
import { googleEnvelope } from '../errors'
import { authorizeApiRequest } from '../middleware/auth'
import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
import { processMessage } from '../proxyStream'
import { estimateGeminiRequestTokens } from '../tokens/estimateGeminiRequestTokens'
import { resolveGeminiGatewayModelAddress } from '../utils/models'
import { GeminiGenerateContentBodySchema } from './schemas'

/** Generation methods the gateway serves under `/v1beta/models/{model}:{method}`. */
const GENERATE_METHODS = new Set(['generateContent', 'streamGenerateContent'])

/**
 * Split the wildcard path segment `providerId:apiModelId:method` into its model
 * (`providerId:apiModelId`, kept intact for `processMessage`) and the trailing
 * method. The model itself contains a colon, so the method is taken off the LAST
 * colon. Returns `null` when there is no method separator.
 */
function parseModelMethod(raw: string): { model: string; method: string } | null {
  const lastColon = raw.lastIndexOf(':')
  if (lastColon <= 0 || lastColon >= raw.length - 1) return null
  return { model: raw.slice(0, lastColon), method: raw.slice(lastColon + 1) }
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
 * body. `:countTokens` estimates the converted representation via the shared local walker
 * (incl. media) — local-only, since the Google SDK exposes no custom-`fetch` hook to honour
 * the app proxy/auth. Errors are shaped into the Google envelope by the app's root `onError`
 * (path-based → `googleErrorHandler`).
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
      const { method } = parsed
      if (method !== 'countTokens' && !GENERATE_METHODS.has(method)) {
        return status(400, invalidArgument(`Unsupported method: "${method}".`))
      }

      if (method === 'countTokens') {
        let countModel = parsed.model
        let taggedParseError: Error | undefined
        try {
          const taggedAddress =
            parseGeminiGatewayModelId(parsed.model) ?? parseAntigravityGatewayModelPath(parsed.model)
          if (taggedAddress) {
            countModel = formatGatewayModelId(taggedAddress.providerId, taggedAddress.apiModelId)
          }
        } catch (error) {
          taggedParseError = error instanceof Error ? error : new Error('Invalid gateway model address')
        }
        if (countModel === parsed.model) {
          try {
            countModel = resolveGeminiGatewayModelAddress(parsed.model)
          } catch {
            if (taggedParseError) return status(400, invalidArgument(taggedParseError.message))
          }
        }
        return {
          totalTokens: await estimateGeminiRequestTokens(body as InputParamsMap['gemini'], countModel, request.signal)
        }
      }

      let model: string
      try {
        model = resolveGeminiGatewayModelAddress(parsed.model)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid gateway model address'
        return status(400, invalidArgument(message))
      }

      return processMessage({
        params: body,
        modelString: model,
        streaming: method === 'streamGenerateContent',
        inputFormat: 'gemini',
        outputFormat: 'gemini',
        signal: request.signal,
        requestHeaders: request.headers
      })
    },
    {
      body: GeminiGenerateContentBodySchema,
      // `summary` is Gemini's own canonical method name; only `description` is
      // localized, per request (see chat.ts).
      detail: {
        tags: [DOC_TAGS.gemini],
        summary: 'generateContent',
        description: DOC_DESCRIPTIONS.generate_content
      }
    }
  )
