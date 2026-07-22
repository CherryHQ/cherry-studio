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
import { tryRemoteGeminiCount } from './remoteGeminiCount'

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
 * downstream provider receives.
 *
 * - **google dialect** → the provider's own `:countTokens` (authoritative), with the local
 *   estimate as fallback. The Gemini input is already wire format, so the raw body is
 *   forwarded verbatim.
 * - **everything else** → local: the same Gemini→`ModelMessage[]` conversion the real
 *   request uses, tokenized (text via `tokenx`, images via the per-dialect pixel formula).
 *
 * Never throws: on model-resolve failure it degrades to the Google dialect with all-media
 * caps, and if the loosely-validated body defeats the converter it degrades further to a
 * raw-size heuristic — countTokens must not 500 a client.
 */
export async function estimateGeminiRequestTokens(
  body: GeminiGenerateContentRequest,
  modelString: string
): Promise<number> {
  try {
    return await estimateConvertedRequest(body, modelString)
  } catch (error) {
    logger.warn('conversion-based estimate failed, using raw-size heuristic', error as Error)
    return tokenxTokenizer.count(JSON.stringify(body))
  }
}

async function estimateConvertedRequest(body: GeminiGenerateContentRequest, modelString: string): Promise<number> {
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

  if (dialect === 'google' && resolved) {
    const remote = await tryRemoteGeminiCount(body, resolved.provider, resolved.model, resolved.apiModelId)
    if (remote !== undefined) return remote
  }

  const toolResultCaps = resolveToolResultMediaCapabilities(caps, dialect)
  const modelMessages = await toModelMessages(uiMessages, caps, tools, toolResultCaps)
  const tokenizer = await getTextTokenizer(dialect)
  const messageTokens = await estimateModelMessagesFootprint(modelMessages, { dialect, tokenizer })
  return messageTokens + countGeminiToolDefs(body.tools, tokenizer)
}
