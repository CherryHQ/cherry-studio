import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import {
  ALL_MEDIA,
  resolveMediaCapabilities,
  resolveToolResultMediaCapabilities
} from '@main/ai/messages/messageCapabilities'
import { toModelMessages } from '@main/ai/messages/messageRules'
import { resolveModelTokenDialect, type TokenDialect } from '@main/ai/tokens/dialect'
import { countToolDefs, estimateModelMessagesFootprint } from '@main/ai/tokens/footprint'
import { getTextTokenizer } from '@main/ai/tokens/profiles'
import { tokenxTokenizer } from '@main/ai/tokens/textTokenizer'

import { MessageConverterFactory } from '../adapters'
import { type ResolvedGatewayModelAddress, resolveGatewayModelAddress } from '../utils/models'
import { tryRemoteAnthropicCount } from './remoteAnthropicCount'

const logger = loggerService.withContext('GatewayTokenEstimate')

/**
 * Estimate `input_tokens` for `POST /v1/messages/count_tokens` against the representation
 * the downstream provider actually receives.
 *
 * - **anthropic dialect** → the provider's own `count_tokens` (authoritative), with the
 *   local estimate as fallback when the endpoint/credentials are unavailable.
 * - **everything else** → local: run the same Anthropic→`ModelMessage[]` conversion the
 *   real `/messages` request uses, then tokenize it (openai via `gpt-tokenizer`, others via
 *   `tokenx`; images via the per-dialect pixel formula). This is why capability-stripped
 *   images and tool definitions are counted correctly — unlike the old raw-body walk.
 *
 * Never throws: on model-resolve failure it degrades to the Anthropic dialect with
 * all-media capabilities, and if the loosely-validated body defeats the converter it
 * degrades further to a raw-size heuristic — count_tokens must not 500 a client.
 */
export async function estimateAnthropicRequestTokens(body: MessageCreateParams): Promise<number> {
  try {
    return await estimateConvertedRequest(body)
  } catch (error) {
    // The body is only loosely validated (`content: z.unknown()`, `tools` untyped), so
    // conversion can throw on malformed blocks — degrade instead of surfacing a 500.
    logger.warn('conversion-based estimate failed, using raw-size heuristic', error as Error)
    return tokenxTokenizer.count(JSON.stringify(body))
  }
}

async function estimateConvertedRequest(body: MessageCreateParams): Promise<number> {
  const converter = MessageConverterFactory.create('anthropic')
  const uiMessages = converter.toUIMessages(body)
  const tools = converter.toAiSdkTools?.(body)

  let dialect: TokenDialect = 'anthropic'
  let caps = ALL_MEDIA
  let resolved: ResolvedGatewayModelAddress | undefined
  try {
    resolved = resolveGatewayModelAddress(body.model)
    dialect = resolveModelTokenDialect(resolved.provider, resolved.model)
    caps = resolveMediaCapabilities(resolved.model)
  } catch (error) {
    logger.warn('model resolve failed, using anthropic/all-media fallback', error as Error)
  }

  // Anthropic: prefer the provider's authoritative count; fall through to local on failure.
  if (dialect === 'anthropic' && resolved) {
    const remote = await tryRemoteAnthropicCount(body, resolved.provider, resolved.model, resolved.apiModelId)
    if (remote !== undefined) return remote
  }

  const toolResultCaps = resolveToolResultMediaCapabilities(caps, dialect)
  const modelMessages = await toModelMessages(uiMessages, caps, tools, toolResultCaps)
  const tokenizer = await getTextTokenizer(dialect)
  const messageTokens = await estimateModelMessagesFootprint(modelMessages, { dialect, tokenizer })
  return messageTokens + countToolDefs(body.tools, tokenizer)
}
