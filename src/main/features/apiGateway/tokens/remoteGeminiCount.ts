import { GoogleGenAI } from '@google/genai'
import { loggerService } from '@logger'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { InputParamsMap } from '../adapters'

type GeminiGenerateContentRequest = InputParamsMap['gemini']

const logger = loggerService.withContext('GatewayRemoteGeminiCount')

/** Fail fast to the local estimator — countTokens is a hot, blocking path (see remoteAnthropicCount). */
const REMOTE_COUNT_TIMEOUT_MS = 5_000

/**
 * Authoritative token count from the provider's own `:countTokens`. Best-effort: returns
 * `undefined` (→ caller falls back to the local estimator) when credentials can't be
 * extracted or the call fails — never throws. The gateway's Gemini input is already Gemini
 * wire format, so the raw `contents` are fed verbatim (model id rewritten to `apiModelId`).
 */
export async function tryRemoteGeminiCount(
  body: GeminiGenerateContentRequest,
  provider: Provider,
  model: Model,
  apiModelId: string
): Promise<number | undefined> {
  try {
    if (!body.contents) return undefined
    const cfg = await providerToAiSdkConfig(provider, model)
    const settings = cfg.providerSettings as { baseURL?: string; apiKey?: string }
    const apiKey = settings.apiKey
    if (!apiKey) return undefined
    // ai-core baseURL already carries `/v1beta`; the client re-adds the api version, so strip it.
    const baseUrl = settings.baseURL?.replace(/\/v1beta\/?$/, '')
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: REMOTE_COUNT_TIMEOUT_MS, ...(baseUrl ? { baseUrl } : {}) }
    })
    const res = await ai.models.countTokens({
      model: apiModelId,
      contents: body.contents as never
    })
    return res.totalTokens
  } catch (error) {
    logger.warn('remote gemini countTokens failed, falling back to local estimate', error as Error)
    return undefined
  }
}
