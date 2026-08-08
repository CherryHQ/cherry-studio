import Anthropic from '@anthropic-ai/sdk'
import type { MessageCountTokensParams, MessageCreateParams } from '@anthropic-ai/sdk/resources'
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
 * must never throw. Fed the client's raw Anthropic body with the model id rewritten to the
 * downstream `apiModelId`; post the tool-result-image conversion fix this matches what we
 * actually send to a vision model (for a non-vision model we strip the image while remote
 * still counts it → a safe overcount, earlier compaction).
 */
export async function tryRemoteAnthropicCount(
  body: MessageCreateParams,
  provider: Provider,
  model: Model,
  apiModelId: string
): Promise<number | undefined> {
  try {
    const cfg = await providerToAiSdkConfig(provider, model)
    const settings = cfg.providerSettings as { baseURL?: string; apiKey?: string; headers?: Record<string, string> }
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
      timeout: REMOTE_COUNT_TIMEOUT_MS,
      maxRetries: 0
    })
    const params: MessageCountTokensParams = {
      model: apiModelId,
      messages: body.messages,
      ...(body.system !== undefined ? { system: body.system } : {}),
      ...(body.tools !== undefined ? { tools: body.tools as MessageCountTokensParams['tools'] } : {})
    }
    const { input_tokens } = await client.messages.countTokens(params)
    return input_tokens
  } catch (error) {
    logger.warn('remote count_tokens failed, falling back to local estimate', error as Error)
    return undefined
  }
}
