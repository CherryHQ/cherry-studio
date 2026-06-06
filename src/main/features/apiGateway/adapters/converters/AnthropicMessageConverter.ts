/**
 * Anthropic Message Converter
 *
 * Converts Anthropic Messages API format to AI SDK format.
 * Handles messages, tools, and special content types (images, thinking, tool results).
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type {
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

/**
 * Flatten Anthropic tool_result content into a plain string output for the
 * `dynamic-tool` UI part. `convertToModelMessages` re-wraps it into a tool
 * result model message.
 */
function toolResultToOutput(content: NonNullable<ToolResultBlockParam['content']>): string {
  if (typeof content === 'string') return content
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'image') {
      const source = block.source
      if (source.type === 'base64') {
        parts.push(`data:${source.media_type};base64,${source.data}`)
      } else if (source.type === 'url') {
        parts.push(source.url)
      }
    }
  }
  return parts.join('\n')
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

    // tool_use id → name (for tool_result parts) and tool_use id → result output.
    const toolCallIdToName = new Map<string, string>()
    const toolResultOutputs = new Map<string, string>()
    for (const msg of params.messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolCallIdToName.set(block.id, block.name)
        } else if (block.type === 'tool_result') {
          toolResultOutputs.set(block.tool_use_id, block.content ? toolResultToOutput(block.content) : '')
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
          const source = block.source
          const url =
            source.type === 'base64'
              ? `data:${source.media_type};base64,${source.data}`
              : source.type === 'url'
                ? source.url
                : undefined
          if (url) {
            const part: FileUIPart = {
              type: 'file',
              mediaType: source.type === 'base64' ? source.media_type : 'image/png',
              url
            }
            parts.push(part)
          }
        } else if (block.type === 'tool_use') {
          const callProviderMetadata = this.buildToolCallProviderOptions(params.model, block.name, block.id)
          const hasResult = toolResultOutputs.has(block.id)
          const base = {
            type: 'dynamic-tool' as const,
            toolName: block.name,
            toolCallId: block.id,
            ...(callProviderMetadata ? { callProviderMetadata } : {})
          }
          const part: DynamicToolUIPart = hasResult
            ? { ...base, state: 'output-available', input: block.input, output: toolResultOutputs.get(block.id) }
            : { ...base, state: 'input-available', input: block.input }
          parts.push(part)
        }
        // tool_result blocks are absorbed into their matching tool_use part above.
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
