import { loggerService } from '@logger'
import {
  ALL_MEDIA,
  resolveMediaCapabilities,
  resolveToolResultMediaCapabilities
} from '@main/ai/messages/messageCapabilities'
import { toModelMessages } from '@main/ai/messages/messageRules'
import { resolveModelTokenDialect, type TokenDialect } from '@main/ai/tokens/dialect'
import { countToolTokens, estimateModelMessagesFootprint } from '@main/ai/tokens/footprint'
import { getTextTokenizer } from '@main/ai/tokens/profiles'
import { type TextTokenizer, tokenxTokenizer } from '@main/ai/tokens/textTokenizer'

import { type InputParamsMap, MessageConverterFactory } from '../adapters'
import { type ResolvedGatewayModelAddress, resolveGatewayModelAddress } from '../utils/models'
import { boundedBodyTokens } from './fallbackEstimate'

type GeminiGenerateContentRequest = InputParamsMap['gemini']

const logger = loggerService.withContext('GatewayGeminiTokenEstimate')

/** Tool framing overhead per function declaration (mirrors the shared `countToolDefs`). */
const TOOL_OVERHEAD = 10

/** Gemini tools are `[{ functionDeclarations: [{ name, description, parameters }] }]`. */
function countGeminiToolDefs(tools: unknown, tokenizer: TextTokenizer): number {
  if (!Array.isArray(tools)) return 0
  let total = 0
  for (const group of tools) {
    const declarations = (group as { functionDeclarations?: unknown }).functionDeclarations
    if (!Array.isArray(declarations)) continue
    for (const declaration of declarations) {
      if (!declaration || typeof declaration !== 'object') continue
      const { name, description, parameters, parametersJsonSchema } = declaration as Record<string, unknown>
      total +=
        TOOL_OVERHEAD + countToolTokens({ name, description, schema: parametersJsonSchema ?? parameters }, tokenizer)
    }
  }
  return total
}

/**
 * Estimate `totalTokens` for a Gemini `:countTokens` request against the representation the
 * downstream provider receives: the same Gemini→`ModelMessage[]` conversion the real request
 * uses, tokenized (text via the dialect tokenizer, images via the per-dialect pixel formula),
 * plus the function-declaration schemas. `systemInstruction` becomes a system message in the
 * conversion, so it is counted too.
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
  return messageTokens + countGeminiToolDefs(body.tools, tokenizer)
}
