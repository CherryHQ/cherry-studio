/**
 * Anthropic Message Converter
 *
 * Converts Anthropic Messages API format to AI SDK format.
 * Handles messages, tools, and special content types (images, thinking, tool results).
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  Tool as AnthropicTool,
  ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import type { DynamicToolUIPart, FileUIPart, JSONValue, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import { mapAnthropicThinkingToProviderOptions } from './providerOptionsMapper'

const MAGIC_STRING = 'skip_thought_signature_validator'

/** Match the branch's `isGemini3ModelId`: a gemini-3 family model id. */
function isGemini3ModelId(modelId?: string): boolean {
  if (!modelId) return false
  return modelId.toLowerCase().includes('gemini-3')
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

/** A tool_result split into the model-visible string output and relocated images. */
interface ToolResultConversion {
  output: string
  images: FileUIPart[]
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
function toolResultToOutput(content: NonNullable<ToolResultBlockParam['content']>): ToolResultConversion {
  if (typeof content === 'string') return { output: content, images: [] }
  const lines: string[] = []
  const images: FileUIPart[] = []
  for (const block of content) {
    if (block.type === 'text') {
      lines.push(block.text)
    } else if (block.type === 'image') {
      const file = imageBlockToFilePart(block.source)
      if (file) {
        images.push(file)
        lines.push(`[image ${images.length} (${file.mediaType}): attached in the following user message]`)
      }
    }
  }
  return { output: lines.join('\n'), images }
}

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
   */
  toUIMessages(params: MessageCreateParams): CherryUIMessage[] {
    const messages: CherryUIMessage[] = []

    // System message
    if (params.system) {
      const systemText =
        typeof params.system === 'string'
          ? params.system
          : params.system
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
      if (systemText) {
        messages.push({ id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text: systemText }] })
      }
    }

    // tool_use id → name (for tool_result parts) and tool_use id → result conversion.
    const toolCallIdToName = new Map<string, string>()
    const toolResults = new Map<string, ToolResultConversion>()
    for (const msg of params.messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolCallIdToName.set(block.id, block.name)
        } else if (block.type === 'tool_result') {
          toolResults.set(
            block.tool_use_id,
            block.content ? toolResultToOutput(block.content) : { output: '', images: [] }
          )
        }
      }
    }

    for (const msg of params.messages) {
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
          const part: TextUIPart = { type: 'text', text: block.text }
          parts.push(part)
        } else if (block.type === 'thinking') {
          const part: ReasoningUIPart = { type: 'reasoning', text: block.thinking }
          parts.push(part)
        } else if (block.type === 'redacted_thinking') {
          const part: ReasoningUIPart = { type: 'reasoning', text: block.data }
          parts.push(part)
        } else if (block.type === 'image') {
          const part = imageBlockToFilePart(block.source)
          if (part) {
            parts.push(part)
          }
        } else if (block.type === 'tool_use') {
          const callProviderMetadata = this.buildToolCallProviderOptions(params.model, block.name, block.id)
          const result = toolResults.get(block.id)
          const base = {
            type: 'dynamic-tool' as const,
            toolName: block.name,
            toolCallId: block.id,
            ...(callProviderMetadata ? { callProviderMetadata } : {})
          }
          const part: DynamicToolUIPart = result
            ? { ...base, state: 'output-available', input: block.input, output: result.output }
            : { ...base, state: 'input-available', input: block.input }
          parts.push(part)
        } else if (block.type === 'tool_result') {
          // The string output is absorbed into the matching tool_use part above;
          // relocated tool-result images surface here as user-message file parts.
          const images = toolResults.get(block.tool_use_id)?.images
          if (images?.length) {
            parts.push(...images)
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
  private buildToolCallProviderOptions(
    model: string | undefined,
    toolName: string,
    toolCallId: string
  ): ProviderOptions | undefined {
    const options: ProviderOptions = {}
    if (isGemini3ModelId(model) && this.googleReasoningCache?.get(`google-${toolName}`)) {
      options.google = { thoughtSignature: MAGIC_STRING }
    }
    const reasoningDetails = this.openRouterReasoningCache?.get(`openrouter-${toolCallId}`)
    if (reasoningDetails) {
      options.openrouter = { reasoning_details: (sanitizeJson(reasoningDetails) as JSONValue[]) || [] }
    }
    return Object.keys(options).length > 0 ? options : undefined
  }

  /**
   * Convert Anthropic tools to an AI SDK `ToolSet` (client tools, no `execute`).
   */
  toAiSdkTools(params: MessageCreateParams): ToolSet | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: ToolSet = {}
    for (const anthropicTool of tools) {
      if (anthropicTool.type === 'bash_20250124') continue
      const toolDef = anthropicTool as AnthropicTool
      const rawSchema = toolDef.input_schema
      const schema = jsonSchemaToZod(rawSchema as JsonSchemaLike)

      const aiTool = tool({
        description: toolDef.description || '',
        inputSchema: zodSchema(schema)
      })

      aiSdkTools[toolDef.name] = aiTool
    }
    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
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
  extractProviderOptions(provider: Provider, params: MessageCreateParams): ProviderOptions | undefined {
    return mapAnthropicThinkingToProviderOptions(provider, params.thinking)
  }
}

export default AnthropicMessageConverter
