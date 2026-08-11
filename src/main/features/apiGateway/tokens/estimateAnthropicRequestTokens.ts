import type { MessageCountTokensParams, MessageCreateParams } from '@anthropic-ai/sdk/resources'
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
import { boundedBodyTokens } from './fallbackEstimate'
import { tryRemoteAnthropicCount } from './remoteAnthropicCount'
import { toWireToolDefs } from './wireToolDefs'

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
  // The remote request is the wire-converted one: historical `tool_use.name`s are rewritten
  // with the converter's mapping so they match the normalized definitions — else the endpoint
  // could reject the mismatch, or count an oversize raw name generation never transmits.
  if (dialect === 'anthropic' && resolved) {
    const rename = converter.toProviderToolName?.bind(converter)
    const remote = await tryRemoteAnthropicCount(
      {
        messages: rename ? renameToolUses(body.messages, rename) : body.messages,
        ...(body.system !== undefined ? { system: body.system } : {}),
        ...(wireTools !== undefined ? { tools: wireTools as MessageCountTokensParams['tools'] } : {})
      },
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

/** Rewrite historical `tool_use.name`s to the same wire-safe names the tool definitions use. */
function renameToolUses(
  messages: MessageCreateParams['messages'],
  rename: (toolName: string) => string
): MessageCreateParams['messages'] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg
    let changed = false
    const content = msg.content.map((block) => {
      if (block.type !== 'tool_use' || typeof block.name !== 'string') return block
      const name = rename(block.name)
      if (name === block.name) return block
      changed = true
      return { ...block, name }
    })
    return changed ? { ...msg, content } : msg
  })
}
