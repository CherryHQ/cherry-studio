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

import { type InputParamsMap, MessageConverterFactory } from '../adapters'
import { type ResolvedGatewayModelAddress, resolveGatewayModelAddress } from '../utils/models'
import { boundedBodyTokens } from './fallbackEstimate'
import { toWireToolDefs } from './wireToolDefs'

type GeminiGenerateContentRequest = InputParamsMap['gemini']

const logger = loggerService.withContext('GatewayGeminiTokenEstimate')

/**
 * Estimate `totalTokens` for a Gemini `:countTokens` request against the representation the
 * downstream provider receives: the same Gemini→`ModelMessage[]` conversion the real request
 * uses, tokenized (text via the dialect tokenizer, images via the per-dialect pixel formula),
 * plus the wire tool definitions rebuilt from the converted `ToolSet` — declarations the
 * converter drops (no `name`) are not counted, and schemas are the canonical form generation
 * sends. `systemInstruction` becomes a system message in the conversion, so it is counted too.
 *
 * Local-only by design: unlike the Anthropic path, the Google SDK exposes no custom-`fetch`
 * hook, so a remote count could not honour the app proxy / relay signing — and a
 * `contents`-only remote call would silently drop `systemInstruction`/`tools`. The local
 * walker counts the whole request faithfully.
 *
 * Never throws: on model-resolve failure it degrades to the Google dialect with all-media
 * caps, and if the loosely-validated body defeats the converter it degrades further to a
 * bounded raw-body estimate — countTokens must not 500 a client.
 */
export async function estimateGeminiRequestTokens(
  body: GeminiGenerateContentRequest,
  modelString: string,
  signal?: AbortSignal
): Promise<number> {
  try {
    return await estimateConvertedRequest(body, modelString, signal)
  } catch (error) {
    logger.warn('conversion-based estimate failed, using bounded raw-body estimate', error as Error)
    return boundedBodyTokens(body, tokenxTokenizer)
  }
}

async function estimateConvertedRequest(
  body: GeminiGenerateContentRequest,
  modelString: string,
  signal?: AbortSignal
): Promise<number> {
  const converter = MessageConverterFactory.create('gemini')
  const uiMessages = converter.toUIMessages(body)
  const tools = converter.toAiSdkTools?.(body)
  const wireTools = await toWireToolDefs(tools)

  let dialect: TokenDialect = 'google'
  let caps = ALL_MEDIA
  let resolved: ResolvedGatewayModelAddress | undefined
  try {
    resolved = resolveGatewayModelAddress(modelString)
    dialect = resolveModelTokenDialect(resolved.provider, resolved.model)
    caps = resolveMediaCapabilities(resolved.model)
  } catch (error) {
    logger.warn('model resolve failed, using google/all-media fallback', error as Error)
  }

  const toolResultCaps = resolveToolResultMediaCapabilities(caps, dialect)
  const modelMessages = await toModelMessages(uiMessages, caps, tools, toolResultCaps)
  const tokenizer = await getTextTokenizer(dialect)
  const messageTokens = await estimateModelMessagesFootprint(modelMessages, { dialect, tokenizer }, signal)
  return messageTokens + countToolDefs(wireTools, tokenizer)
}
