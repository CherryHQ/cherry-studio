/**
 * Anthropic Message Converter
 *
 * Converts Anthropic Messages API format to AI SDK format.
 * Handles messages, tools, and special content types (images, thinking, tool results).
 */

import { createHash } from 'node:crypto'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  MessageParam,
  Tool as AnthropicTool,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages'
import type {
  DynamicToolUIPart,
  FileUIPart,
  JSONValue,
  ProviderMetadata,
  ReasoningUIPart,
  TextUIPart,
  ToolSet
} from 'ai'
import { tool, zodSchema } from 'ai'

import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGemini3ModelId } from '@shared/utils/model'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import { mapAnthropicThinkingToProviderOptions } from './providerOptionsMapper'

const RESPONSES_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const RESPONSES_TOOL_NAME_MAX_LENGTH = 64
const TOOL_NAME_HASH_LENGTH = 12

/**
 * An inbound `cache_control` breakpoint marker from an Anthropic-format request.
 * Anthropic clients (Claude Agent SDK, Claude Code) place ≤4 of these to pin the
 * prompt-prefix cache; they are preserved on the converted parts so dialects that
 * can honor them (Anthropic targets re-emit via `providerOptions.anthropic`) keep
 * the client's cache plan instead of silently re-prefilling every round.
 */
type InboundCacheControl = {
  type: 'ephemeral'
  ttl?: '5m' | '1h'
}

/** The `cache_control` marker on a content block, narrowed to the shape we forward. */
function blockCacheControl(block: object): InboundCacheControl | undefined {
  const marker = (block as { cache_control?: { type?: string; ttl?: string } | null }).cache_control
  if (!marker || marker.type !== 'ephemeral') return undefined
  return marker.ttl === '5m' || marker.ttl === '1h' ? { type: 'ephemeral', ttl: marker.ttl } : { type: 'ephemeral' }
}

/** Last `cache_control` among content blocks — clients mark the tail of a cacheable prefix. */
function lastBlockCacheControl(
  content: MessageCreateParams['system'] | MessageParam['content']
): InboundCacheControl | undefined {
  if (!Array.isArray(content)) return undefined
  let marker: InboundCacheControl | undefined
  for (const block of content) {
    const found = blockCacheControl(block)
    if (found) marker = found
  }
  return marker
}

/** Attach an inbound marker to a UI part's `anthropic` provider metadata (kept alongside any existing keys). */
function withAnthropicCacheControl<P extends { providerMetadata?: ProviderMetadata }>(
  part: P,
  cacheControl: InboundCacheControl
): P {
  const providerMetadata: ProviderMetadata = {
    ...part.providerMetadata,
    anthropic: { ...part.providerMetadata?.anthropic, cacheControl }
  }
  return { ...part, providerMetadata }
}

/** Merge a marker into converter-built provider options (tool calls have no UI part to hang it on). */
function mergeAnthropicCacheControl(
  options: ProviderOptions | undefined,
  cacheControl: InboundCacheControl | undefined
): ProviderOptions | undefined {
  if (!cacheControl) return options
  return { ...options, anthropic: { ...options?.anthropic, cacheControl } }
}

function isResponsesCompatibleToolName(name: string): boolean {
  return name.length <= RESPONSES_TOOL_NAME_MAX_LENGTH && RESPONSES_TOOL_NAME_PATTERN.test(name)
}

function sanitizeDescription(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += value[i]
      continue
    }
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) continue
    out += value[i]
  }
  return out
}

function buildResponsesToolName(name: string, attempt: number): string {
  const sanitized = Array.from(name, (char) => (RESPONSES_TOOL_NAME_PATTERN.test(char) ? char : '_')).join('') || '_'
  const hash = createHash('sha1').update(`${name}\0${attempt}`).digest('hex').slice(0, TOOL_NAME_HASH_LENGTH)
  const prefixLength = RESPONSES_TOOL_NAME_MAX_LENGTH - hash.length - 1
  return `${sanitized.slice(0, prefixLength)}_${hash}`
}

/** The `apiModelId` half of a gateway `providerId:apiModelId` address, split at the
 *  first `:` like the routes do — a bare model id passes through unchanged. */
function toApiModelId(modelAddress: string): string {
  return modelAddress.slice(modelAddress.indexOf(':') + 1)
}

let uiMessageSeq = 0
function nextUIMessageId(): string {
  return `gateway-msg-${Date.now()}-${uiMessageSeq++}`
}

/**
 * Sanitize value for JSON serialization
 */
function sanitizeJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value))
}

/** An Anthropic image block as a `file` UI part (undefined for unknown sources). */
function imageBlockToFilePart(source: ImageBlockParam['source']): FileUIPart | undefined {
  if (source.type === 'base64') {
    return { type: 'file', mediaType: source.media_type, url: `data:${source.media_type};base64,${source.data}` }
  }
  if (source.type === 'url') {
    return { type: 'file', mediaType: 'image/png', url: source.url }
  }
  return undefined
}

/** A tool_result split into the model-visible string output and relocated user parts. */
interface ToolResultConversion {
  output: string
  relocatedParts: Array<TextUIPart | FileUIPart>
}

function toolResultImageAnchor(toolCallId: string, index: number): string {
  return `[tool-result attachment call_id=${JSON.stringify(toolCallId)} image=${index}]`
}

/**
 * Convert Anthropic tool_result content for the `dynamic-tool` UI part.
 *
 * Image blocks cannot ride inside the tool output: `convertToModelMessages`
 * only supports string/JSON tool outputs there, and OpenAI-style protocols have
 * no image tool content at all — inlining base64 blows up the prompt (#17078).
 * Instead each image becomes a `file` part relocated into the user message that
 * carried the tool_result (every protocol accepts user images), and the output
 * keeps a placeholder pointing at it.
 */
function toolResultToOutput(
  toolCallId: string,
  content: NonNullable<ToolResultBlockParam['content']>
): ToolResultConversion {
  if (typeof content === 'string') return { output: content, relocatedParts: [] }
  const lines: string[] = []
  const relocatedParts: Array<TextUIPart | FileUIPart> = []
  let imageIndex = 0
  for (const block of content) {
    if (block.type === 'text') {
      lines.push(block.text)
    } else if (block.type === 'image') {
      const file = imageBlockToFilePart(block.source)
      if (file) {
        const anchor = toolResultImageAnchor(toolCallId, ++imageIndex)
        lines.push(`${anchor} (${file.mediaType}): attached in the following user message`)
        relocatedParts.push({ type: 'text', text: anchor }, file)
      }
    }
  }
  return { output: lines.join('\n'), relocatedParts }
}

/** Anthropic text content (`string` or content blocks) flattened to one string. */
function textContentToString(content: MessageCreateParams['system'] | MessageParam['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

/**
 * The Claude Agent SDK puts `system` messages inside `messages` (agent/skill catalogs,
 * deferred-tool notices), which `MessageParam` does not model.
 */
type AgentInputMessage = MessageParam | { role: 'system'; content: MessageParam['content'] }

/**
 * Reasoning cache interface for storing provider-specific reasoning state
 */
export interface ReasoningCache {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/**
 * Anthropic Message Converter
 *
 * Converts Anthropic MessageCreateParams to AI SDK format for unified processing.
 */
export class AnthropicMessageConverter implements IMessageConverter<MessageCreateParams> {
  private googleReasoningCache?: ReasoningCache
  private openRouterReasoningCache?: ReasoningCache
  private mappedTools?: MessageCreateParams['tools']
  private readonly providerToolNames = new Map<string, string>()
  private readonly clientToolNames = new Map<string, string>()

  constructor(options?: { googleReasoningCache?: ReasoningCache; openRouterReasoningCache?: ReasoningCache }) {
    this.googleReasoningCache = options?.googleReasoningCache
    this.openRouterReasoningCache = options?.openRouterReasoningCache
  }

  /**
   * Convert Anthropic MessageCreateParams to AI SDK `CherryUIMessage[]`.
   *
   * The leading system prompt is emitted as a `role: 'system'` UIMessage —
   * `convertToModelMessages` (run by main) lifts that to the SDK `system`.
   * Tool calls become `dynamic-tool` parts; a matching tool_result in a later
   * message upgrades the part to `output-available` so history stays coherent.
   *
   * Inline `system` messages stay at their original index as `role: 'system'`
   * UIMessages. Mapping them by position to `assistant` (every other non-user role)
   * would attribute the Agent SDK's harness context to the model, and hoisting them
   * would rewrite the prompt prefix on every turn one arrives, costing the prefix
   * cache. `hoistSystemMessages` folds them only for targets that reject them.
   *
   * Inbound `cache_control` markers ride along on the parts' `anthropic` provider
   * metadata: Anthropic-dialect targets re-emit them verbatim (the client's cache
   * plan survives the round trip), while OpenAI/Google targets ignore the foreign
   * namespace. `transformAnthropicCacheParams` yields to preserved markers so the
   * two sources never double-book the 4-breakpoint budget.
   */
  toUIMessages(params: MessageCreateParams): CherryUIMessage[] {
    this.prepareToolNames(params.tools)
    const messages: CherryUIMessage[] = []

    // Array covariance widens without a cast, so `role` narrows natively from here on.
    const inputMessages: AgentInputMessage[] = params.messages

    // System message — clients mark its tail block, so flatten keeps that marker.
    const systemText = textContentToString(params.system)
    if (systemText) {
      const systemMarker = lastBlockCacheControl(params.system)
      const base: TextUIPart = { type: 'text', text: systemText }
      const part: TextUIPart = systemMarker ? withAnthropicCacheControl(base, systemMarker) : base
      messages.push({ id: nextUIMessageId(), role: 'system', parts: [part] })
    }

    // tool_use id → result conversion.
    const toolResults = new Map<string, ToolResultConversion>()
    const toolResultCacheMarkers = new Map<string, InboundCacheControl>()
    for (const msg of params.messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResults.set(
            block.tool_use_id,
            block.content ? toolResultToOutput(block.tool_use_id, block.content) : { output: '', relocatedParts: [] }
          )
          const marker = blockCacheControl(block)
          if (marker) toolResultCacheMarkers.set(block.tool_use_id, marker)
        }
      }
    }

    for (const msg of inputMessages) {
      if (msg.role === 'system') {
        const text = textContentToString(msg.content)
        if (text) {
          const marker = lastBlockCacheControl(msg.content)
          const base: TextUIPart = { type: 'text', text }
          const part: TextUIPart = marker ? withAnthropicCacheControl(base, marker) : base
          messages.push({ id: nextUIMessageId(), role: 'system', parts: [part] })
        }
        continue
      }
      const role = msg.role === 'user' ? 'user' : 'assistant'

      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) {
          messages.push({ id: nextUIMessageId(), role, parts: [{ type: 'text', text: msg.content }] })
        }
        continue
      }
      if (!Array.isArray(msg.content)) continue

      const parts: CherryUIMessage['parts'] = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          const marker = blockCacheControl(block)
          const base: TextUIPart = { type: 'text', text: block.text }
          parts.push(marker ? withAnthropicCacheControl(base, marker) : base)
        } else if (block.type === 'thinking') {
          // Preserve the signature (even '') — @ai-sdk/anthropic drops reasoning
          // parts without one, so thinking blocks would never replay upstream (#18150).
          const marker = blockCacheControl(block)
          const base: ReasoningUIPart = {
            type: 'reasoning',
            text: block.thinking,
            providerMetadata: { anthropic: { signature: block.signature } }
          }
          parts.push(marker ? withAnthropicCacheControl(base, marker) : base)
        } else if (block.type === 'redacted_thinking') {
          const part: ReasoningUIPart = {
            type: 'reasoning',
            text: '',
            providerMetadata: { anthropic: { redactedData: block.data } }
          }
          parts.push(part)
        } else if (block.type === 'image') {
          const part = imageBlockToFilePart(block.source)
          if (part) {
            parts.push(part)
          }
        } else if (block.type === 'tool_use') {
          const toolName = this.toProviderToolName(block.name)
          // The marker rides the tool-call provider options. Client tools also replay
          // their result's marker from this same object (the result has no separate
          // carrier on a client-executed tool part); the Anthropic cache middleware
          // drops the call-side duplicate so only the intended breakpoint remains.
          const callProviderMetadata = mergeAnthropicCacheControl(
            this.buildToolCallProviderOptions(params.model, block.id),
            blockCacheControl(block) ?? toolResultCacheMarkers.get(block.id)
          )
          const result = toolResults.get(block.id)
          const base = {
            type: 'dynamic-tool' as const,
            toolName,
            toolCallId: block.id,
            ...(callProviderMetadata ? { callProviderMetadata } : {})
          }
          const part: DynamicToolUIPart = result
            ? { ...base, state: 'output-available', input: block.input, output: result.output }
            : { ...base, state: 'input-available', input: block.input }
          parts.push(part)
        } else if (block.type === 'tool_result') {
          // The string output is absorbed into the matching tool_use part above;
          // relocated images surface here with call-id anchors for parallel results.
          const relocatedParts = toolResults.get(block.tool_use_id)?.relocatedParts
          if (relocatedParts?.length) {
            parts.push(...relocatedParts)
          }
        }
      }

      if (parts.length > 0) {
        messages.push({ id: nextUIMessageId(), role, parts })
      }
    }

    return messages
  }

  /**
   * Reconstruct per-tool-call provider metadata (Gemini thought-signature /
   * OpenRouter reasoning_details) from the reasoning caches, mirroring the
   * branch's assistant/tool-call providerOptions handling.
   */
  private buildToolCallProviderOptions(model: string | undefined, toolCallId: string): ProviderOptions | undefined {
    const options: ProviderOptions = {}
    if (model && isGemini3ModelId(toApiModelId(model))) {
      // Gemini 3 rejects a replayed functionCall whose signature is missing; the
      // Anthropic wire format has nowhere to carry it, so restore it from the cache.
      const thoughtSignature = this.googleReasoningCache?.get(`google-${toolCallId}`)
      if (typeof thoughtSignature === 'string') {
        options.google = { thoughtSignature }
      }
    }
    const reasoningDetails = this.openRouterReasoningCache?.get(`openrouter-${toolCallId}`)
    if (reasoningDetails) {
      options.openrouter = { reasoning_details: sanitizeJson(reasoningDetails) || [] }
    }
    return Object.keys(options).length > 0 ? options : undefined
  }

  /**
   * Convert Anthropic tools to an AI SDK `ToolSet` (client tools, no `execute`).
   */
  toAiSdkTools(params: MessageCreateParams): ToolSet | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined
    this.prepareToolNames(tools)

    const aiSdkTools: ToolSet = {}
    for (const anthropicTool of tools) {
      const toolDef = anthropicTool as AnthropicTool
      const rawSchema = toolDef.input_schema
      // Client tools always carry `input_schema`; without it this is a server tool
      // (bash/web_search/text_editor/tool_search/…) only Anthropic's own backend executes.
      if (!rawSchema) continue
      const schema = jsonSchemaToZod(rawSchema as JsonSchemaLike)

      const aiTool = tool({
        description: sanitizeDescription(toolDef.description || ''),
        inputSchema: zodSchema(schema),
        // The gateway forwards arbitrary Anthropic/MCP schemas. They do not satisfy
        // Responses strict-mode's all-properties-required contract, so match the
        // Codex client's dynamic-tool behavior and opt out explicitly.
        strict: false
      })

      aiSdkTools[this.toProviderToolName(toolDef.name)] = aiTool
    }
    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /** Restore the client-visible identity after the target model calls a normalized tool. */
  toClientToolName(toolName: string): string {
    return this.clientToolNames.get(toolName) ?? toolName
  }

  private prepareToolNames(tools: MessageCreateParams['tools']): void {
    if (tools === this.mappedTools) return

    this.mappedTools = tools
    this.providerToolNames.clear()
    this.clientToolNames.clear()

    const names = [
      ...new Set(
        (tools ?? []).flatMap((toolDef) =>
          'name' in toolDef && typeof toolDef.name === 'string' ? [toolDef.name] : []
        )
      )
    ]

    for (const name of names.filter(isResponsesCompatibleToolName)) {
      this.providerToolNames.set(name, name)
      this.clientToolNames.set(name, name)
    }
    for (const name of names.filter((candidate) => !isResponsesCompatibleToolName(candidate)).sort()) {
      this.registerProviderToolName(name)
    }
  }

  /** Wire-safe name for a client tool name (identity when already compatible). */
  toProviderToolName(toolName: string): string {
    return this.providerToolNames.get(toolName) ?? this.registerProviderToolName(toolName)
  }

  private registerProviderToolName(toolName: string): string {
    if (isResponsesCompatibleToolName(toolName) && !this.clientToolNames.has(toolName)) {
      this.providerToolNames.set(toolName, toolName)
      this.clientToolNames.set(toolName, toolName)
      return toolName
    }

    let attempt = 0
    let providerToolName = buildResponsesToolName(toolName, attempt)
    while (this.clientToolNames.has(providerToolName)) {
      providerToolName = buildResponsesToolName(toolName, ++attempt)
    }
    this.providerToolNames.set(toolName, providerToolName)
    this.clientToolNames.set(providerToolName, toolName)
    return providerToolName
  }

  /**
   * Extract stream/generation options from Anthropic params
   */
  extractStreamOptions(params: MessageCreateParams): StreamTextOptions {
    return {
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      topK: params.top_k,
      stopSequences: params.stop_sequences
    }
  }

  /**
   * Extract provider-specific options from Anthropic params
   * Maps thinking configuration to provider-specific parameters
   */
  extractProviderOptions(
    provider: Provider,
    model: Model,
    params: MessageCreateParams,
    maxOutputTokens?: number
  ): ProviderOptions | undefined {
    return mapAnthropicThinkingToProviderOptions(
      provider,
      model,
      params.thinking,
      params.output_config?.effort,
      maxOutputTokens
    )
  }
}

export default AnthropicMessageConverter
