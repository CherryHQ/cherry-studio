import { createHash } from 'node:crypto'

import { APICallError, UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { copilotService } from '@main/services/CopilotService'
import { mergeHeaders } from '@main/utils/http'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { withoutTrailingSlash } from '@shared/utils/api'
import { getRawModelId } from '@shared/utils/model'

import { getBaseUrl, getExtraHeaders } from '../utils/provider'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import type { ResolvedEndpoint } from './endpoint'
import { CopilotModelsResponseSchema } from './listModelsSchemas'
import { getFromApi } from './modelListApi'

const logger = loggerService.withContext('CopilotModels')
type Catalog = z.infer<typeof CopilotModelsResponseSchema>
type CopilotSession = { token: string; headers: Record<string, string>; revision: number }
const endpointPaths = [
  ['/responses', ENDPOINT_TYPE.OPENAI_RESPONSES],
  ['/v1/messages', ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
  ['/chat/completions', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
] as const

export function copilotEndpointTypes(paths: string[] | null | undefined): EndpointType[] | undefined {
  return paths == null ? undefined : endpointPaths.filter(([path]) => paths.includes(path)).map(([, type]) => type)
}

function withSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function checkRevision(revision: number) {
  if (revision !== copilotService.authRevision) throw new DOMException('Copilot credentials changed', 'AbortError')
}

export async function getCopilotSession(provider: Provider, signal?: AbortSignal): Promise<CopilotSession> {
  signal?.throwIfAborted()
  const revision = copilotService.authRevision
  const headers = mergeHeaders(COPILOT_DEFAULT_HEADERS, getExtraHeaders(provider))
  const { token } = await withSignal(copilotService.getToken(null as never, COPILOT_DEFAULT_HEADERS), signal)
  checkRevision(revision)
  return { token, headers: mergeHeaders(headers, { Authorization: `Bearer ${token}` }), revision }
}

export async function getCopilotModels(
  provider: Provider,
  session: CopilotSession,
  options: { signal?: AbortSignal; refresh?: boolean } = {}
): Promise<Catalog> {
  options.signal?.throwIfAborted()
  checkRevision(session.revision)
  const url = `${withoutTrailingSlash(getBaseUrl(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))}/models`
  const key = `copilot.models:${createHash('sha256')
    .update(JSON.stringify([provider.id, url, session]))
    .digest('hex')}`
  const pendingKey = `${key}:pending`
  const cache = application.get('CacheService')
  const cached = cache.get<Catalog>(key)
  if (cached && !options.refresh) return cached
  let pending = cache.get<Promise<Catalog>>(pendingKey)
  if (!pending) {
    pending = getFromApi({
      url,
      headers: session.headers,
      responseSchema: CopilotModelsResponseSchema,
      abortSignal: AbortSignal.timeout(10_000)
    })
      .then((result) => {
        checkRevision(session.revision)
        if (cache.get(pendingKey) === pending) cache.set(key, result, 5 * 60_000)
        return result
      })
      .finally(() => {
        if (cache.get(pendingKey) === pending) cache.delete(pendingKey)
      })
    cache.set(pendingKey, pending, 10_000)
  }
  return withSignal(pending, options.signal)
}

export async function resolveCopilotModel(provider: Provider, model: Model, signal?: AbortSignal) {
  const session = await getCopilotSession(provider, signal)
  let catalog: Catalog | undefined
  try {
    catalog = await getCopilotModels(provider, session, { signal })
  } catch (error) {
    signal?.throwIfAborted()
    checkRevision(session.revision)
    if (APICallError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) throw error
    logger.warn('Copilot model capabilities unavailable; retaining legacy routing', { providerId: provider.id })
  }
  const modelId = getRawModelId(model)
  checkRevision(session.revision)
  const metadata = catalog?.data.find((item) => item.id === modelId)
  const endpoints = copilotEndpointTypes(metadata?.supported_endpoints)
  if (endpoints?.length === 0 || metadata?.policy?.state === 'disabled') {
    throw new UnsupportedFunctionalityError({ functionality: `copilot.model-endpoint:${modelId}` })
  }
  const endpointType =
    endpoints?.[0] ??
    (modelId.startsWith('gpt-5') || modelId.startsWith('gpt-6')
      ? ENDPOINT_TYPE.OPENAI_RESPONSES
      : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  let baseUrl = getBaseUrl(provider, endpointType)
  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES && !provider.endpointConfigs?.[endpointType]?.baseUrl) {
    baseUrl = `${withoutTrailingSlash(baseUrl).replace(/\/v1$/, '')}/v1`
  }
  const endpoint: ResolvedEndpoint = { endpointType, baseUrl }
  return { ...session, endpoint }
}
