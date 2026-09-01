import Anthropic from '@anthropic-ai/sdk'
import type { MessageCountTokensParams } from '@anthropic-ai/sdk/resources'

import { loggerService } from '@logger'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('GatewayRemoteCount')

/**
 * count_tokens is a hot, blocking path for CLI clients — fail fast to the local estimator
 * instead of the SDK defaults (10-minute timeout × 3 attempts) stalling on a hung relay.
 */
const REMOTE_COUNT_TIMEOUT_MS = 5_000

/**
 * Authoritative token count from the provider's own `/v1/messages/count_tokens`.
 *
 * **Best-effort:** returns `undefined` (→ caller falls back to the local estimator) when
 * credentials can't be extracted, the endpoint is missing, or the call fails — the count
 * must never throw. `request` is the caller's wire-converted view of the body (historical
 * `tool_use.name`s rewritten with the converter's mapping, `tools` replaced by the
 * normalized definitions) with the model id rewritten to the downstream `apiModelId` — the
 * remote must count what generation actually sends, not the raw request.
 */
export async function tryRemoteAnthropicCount(
  request: Pick<MessageCountTokensParams, 'messages' | 'system' | 'tools'>,
  provider: Provider,
  model: Model,
  apiModelId: string,
  signal?: AbortSignal
): Promise<number | undefined> {
  try {
    const cfg = await providerToAiSdkConfig(provider, model)
    const settings = cfg.providerSettings as {
      baseURL?: string
      apiKey?: string
      headers?: Record<string, string>
      // The proxy-aware `customFetch` (+ any provider signing wrapper) `providerToAiSdkConfig`
      // installs — reused so count traffic honours the app proxy / relay auth, not bypasses it.
      fetch?: typeof globalThis.fetch
    }
    const apiKey = settings.apiKey
    // ai-core baseURL ends in `/v1`; the official SDK re-appends `/v1/messages/count_tokens`,
    // so strip the trailing `/v1` to avoid `…/v1/v1/…`. Relay-shaped configs put the URL/key
    // in other fields → undefined here → local fallback.
    const baseURL = settings.baseURL?.replace(/\/v1\/?$/, '')
    if (!apiKey || !baseURL) return undefined

    const client = new Anthropic({
      apiKey,
      baseURL,
      defaultHeaders: settings.headers,
      fetch: settings.fetch,
      timeout: REMOTE_COUNT_TIMEOUT_MS,
      maxRetries: 0
    })
    const params: MessageCountTokensParams = { model: apiModelId, ...request }
    const { input_tokens } = await client.messages.countTokens(params, { signal })
    return input_tokens
  } catch (error) {
    logger.warn('remote count_tokens failed, falling back to local estimate', error as Error)
    return undefined
  }
}
