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
import { asSchema, type ToolSet } from 'ai'

import { MessageConverterFactory } from '../adapters'
import { type ResolvedGatewayModelAddress, resolveGatewayModelAddress } from '../utils/models'
import { boundedBodyTokens } from './fallbackEstimate'
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
 * degrades further to a bounded raw-body estimate — count_tokens must not 500 a client.
 */
export async function estimateAnthropicRequestTokens(body: MessageCreateParams, signal?: AbortSignal): Promise<number> {
  try {
    return await estimateConvertedRequest(body, signal)
  } catch (error) {
    // The body is only loosely validated (`content: z.unknown()`, `tools` untyped), so
    // conversion can throw on malformed blocks — degrade instead of surfacing a 500.
    logger.warn('conversion-based estimate failed, using bounded raw-body estimate', error as Error)
    return boundedBodyTokens(body, tokenxTokenizer)
  }
}

async function estimateConvertedRequest(body: MessageCreateParams, signal?: AbortSignal): Promise<number> {
  const converter = MessageConverterFactory.create('anthropic')
  const uiMessages = converter.toUIMessages(body)
  const tools = converter.toAiSdkTools?.(body)
  // The tool definitions generation actually sends — rebuilt from the converter's ToolSet:
  // its keys are the normalized (wire-safe) names, `bash_20250124` is already dropped, and
  // each schema is the canonical JSONSchema serialized from the zod conversion. Counting and
  // remote-counting these keeps the estimate wire-equivalent: an oversize invalid name or
  // unsupported schema content in the raw body never reaches the wire, so it must not
  // dominate the count.
  const wireTools = await toWireToolDefs(tools)

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
    const remote = await tryRemoteAnthropicCount(
      body,
      wireTools,
      resolved.provider,
      resolved.model,
      resolved.apiModelId,
      signal
    )
    if (remote !== undefined) return remote
  }

  const toolResultCaps = resolveToolResultMediaCapabilities(caps, dialect)
  const modelMessages = await toModelMessages(uiMessages, caps, tools, toolResultCaps)
  const tokenizer = await getTextTokenizer(dialect)
  const messageTokens = await estimateModelMessagesFootprint(modelMessages, { dialect, tokenizer }, signal)
  return messageTokens + countToolDefs(wireTools, tokenizer)
}

/** One wire tool definition in Anthropic shape (what `countToolDefs` and remote count consume). */
interface WireToolDef {
  name: string
  description?: string
  input_schema: unknown
}

async function toWireToolDefs(tools: ToolSet | undefined): Promise<WireToolDef[] | undefined> {
  if (!tools) return undefined
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: await canonicalSchema(tool.inputSchema)
    }))
  )
}

/** Canonical JSONSchema as the SDK serializes it; a minimal object schema on failure. */
async function canonicalSchema(schema: unknown): Promise<unknown> {
  try {
    return (await asSchema(schema as Parameters<typeof asSchema>[0]).jsonSchema) ?? { type: 'object' }
  } catch {
    return { type: 'object' }
  }
}
