/**
 * OpenAI Message Converter
 *
 * Converts OpenAI Chat Completions API format to AI SDK format.
 * Handles messages, tools, and extended features like reasoning_content.
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionUserMessageParam
} from '@cherrystudio/openai/resources'
import type { ChatCompletionCreateParamsBase } from '@cherrystudio/openai/resources/chat/completions'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import { parseDataUrl } from '@shared/utils/dataUrl'
import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import { mapReasoningEffortToProviderOptions } from './providerOptionsMapper'

let uiMessageSeq = 0
function nextUIMessageId(): string {
  return `gateway-msg-${Date.now()}-${uiMessageSeq++}`
}

/**
 * Extended ChatCompletionCreateParams with reasoning_effort support
 * Extends the base OpenAI params to inherit all standard parameters
 */
export interface ExtendedChatCompletionCreateParams extends ChatCompletionCreateParamsBase {
  /**
   * Allow additional provider-specific parameters
   */
  [key: string]: unknown
}

/**
 * Extended assistant message with reasoning_content support (DeepSeek-style)
 */
interface ExtendedAssistantMessage extends ChatCompletionAssistantMessageParam {
  reasoning_content?: string | null
}

/**
 * OpenAI Message Converter
 *
 * Converts OpenAI Chat Completions API format to AI SDK format.
 * Supports standard OpenAI messages plus extended features:
 * - reasoning_content (DeepSeek-style thinking)
 * - reasoning_effort parameter
 */
export class OpenAiMessageConverter implements IMessageConverter<ExtendedChatCompletionCreateParams> {
  /**
   * Convert OpenAI ChatCompletionCreateParams to AI SDK `CherryUIMessage[]`.
   *
   * Tool results (OpenAI `role: 'tool'` messages) are folded into the matching
   * assistant `dynamic-tool` part so `convertToModelMessages` reconstructs the
   * call/result pair coherently.
   */
  toUIMessages(params: ExtendedChatCompletionCreateParams): CherryUIMessage[] {
    // tool_call_id → name (from assistant tool_calls) and → result output.
    const toolCallIdToName = new Map<string, string>()
    const toolResultOutputs = new Map<string, string>()
    for (const msg of params.messages) {
      if (msg.role === 'assistant') {
        const assistantMsg = msg
        for (const toolCall of assistantMsg.tool_calls ?? []) {
          if (toolCall.type === 'function') toolCallIdToName.set(toolCall.id, toolCall.function.name)
        }
      } else if (msg.role === 'tool') {
        const toolMsg = msg
        toolResultOutputs.set(
          toolMsg.tool_call_id,
          typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
        )
      }
    }

    const messages: CherryUIMessage[] = []
    for (const msg of params.messages) {
      const converted = this.convertMessage(msg, toolResultOutputs)
      if (converted) messages.push(converted)
    }
    return messages
  }

  /**
   * Convert a single OpenAI message to a UIMessage (or null to skip).
   */
  private convertMessage(
    msg: ChatCompletionMessageParam,
    toolResultOutputs: Map<string, string>
  ): CherryUIMessage | null {
    switch (msg.role) {
      // `developer` is the renamed instruction role for newer/o-series models; same
      // semantics as `system`, so map it identically rather than dropping it.
      case 'system':
      case 'developer':
        return this.convertSystemMessage(msg)
      case 'user':
        return this.convertUserMessage(msg)
      case 'assistant':
        return this.convertAssistantMessage(msg as ExtendedAssistantMessage, toolResultOutputs)
      // 'tool' results are folded into the assistant part; standalone tool/function
      // messages have no UIMessage representation here.
      default:
        return null
    }
  }

  private convertSystemMessage(msg: ChatCompletionMessageParam): CherryUIMessage | null {
    if (msg.role !== 'system' && msg.role !== 'developer') return null

    let text = ''
    if (typeof msg.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    }
    if (!text) return null
    return { id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text }] }
  }

  private convertUserMessage(msg: ChatCompletionUserMessageParam): CherryUIMessage | null {
    if (typeof msg.content === 'string') {
      if (!msg.content) return null
      return { id: nextUIMessageId(), role: 'user', parts: [{ type: 'text', text: msg.content }] }
    }

    if (Array.isArray(msg.content)) {
      const parts: CherryUIMessage['parts'] = []
      for (const part of msg.content) {
        if (part.type === 'text') {
          const p: TextUIPart = { type: 'text', text: part.text }
          parts.push(p)
        } else if (part.type === 'image_url') {
          const url = part.image_url.url
          // Derive the MIME from a `data:` URL; fall back to `image/*` for remote
          // URLs so JPEG/WebP/etc. aren't mislabeled as PNG downstream.
          const mediaType = parseDataUrl(url)?.mediaType ?? 'image/*'
          const p: FileUIPart = { type: 'file', mediaType, url }
          parts.push(p)
        }
      }
      if (parts.length > 0) return { id: nextUIMessageId(), role: 'user', parts }
    }

    return null
  }

  private convertAssistantMessage(
    msg: ExtendedAssistantMessage,
    toolResultOutputs: Map<string, string>
  ): CherryUIMessage | null {
    const parts: CherryUIMessage['parts'] = []

    // reasoning_content (DeepSeek-style thinking)
    if (msg.reasoning_content) {
      const p: ReasoningUIPart = { type: 'reasoning', text: msg.reasoning_content }
      parts.push(p)
    }

    if (msg.content) {
      if (typeof msg.content === 'string') {
        parts.push({ type: 'text', text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') parts.push({ type: 'text', text: part.text })
        }
      }
    }

    for (const toolCall of msg.tool_calls ?? []) {
      if (toolCall.type !== 'function') continue
      let input: unknown
      try {
        input = JSON.parse(toolCall.function.arguments)
      } catch {
        input = { raw: toolCall.function.arguments }
      }
      const hasResult = toolResultOutputs.has(toolCall.id)
      const base = { type: 'dynamic-tool' as const, toolName: toolCall.function.name, toolCallId: toolCall.id }
      const part: DynamicToolUIPart = hasResult
        ? { ...base, state: 'output-available', input, output: toolResultOutputs.get(toolCall.id) }
        : { ...base, state: 'input-available', input }
      parts.push(part)
    }

    if (parts.length > 0) return { id: nextUIMessageId(), role: 'assistant', parts }
    return null
  }

  /**
   * Convert OpenAI tools to an AI SDK `ToolSet` (client tools, no `execute`).
   */
  toAiSdkTools(params: ExtendedChatCompletionCreateParams): ToolSet | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: ToolSet = {}

    for (const toolDef of tools) {
      if (toolDef.type !== 'function') continue

      const rawSchema = toolDef.function.parameters
      const schema = rawSchema ? jsonSchemaToZod(rawSchema as JsonSchemaLike) : jsonSchemaToZod({ type: 'object' })

      const aiTool = tool({
        description: toolDef.function.description || '',
        inputSchema: zodSchema(schema)
      })

      aiSdkTools[toolDef.function.name] = aiTool
    }

    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /**
   * Extract stream/generation options from OpenAI params
   */
  extractStreamOptions(params: ExtendedChatCompletionCreateParams): StreamTextOptions {
    // OpenAI `stop` is `string | string[] | null`; normalize to `string[] | undefined`
    // so a single-string stop isn't passed through as a bogus array downstream.
    const stop = params.stop
    const stopSequences = typeof stop === 'string' ? [stop] : Array.isArray(stop) ? stop : undefined

    return {
      // Prefer max_completion_tokens (current param for newer/o-series models); fall back to legacy
      // max_tokens. `?? undefined` normalizes the SDK's `number | null` fields to `number | undefined`,
      // so an explicit null isn't passed downstream as a bogus value.
      maxOutputTokens: params.max_completion_tokens ?? params.max_tokens ?? undefined,
      temperature: params.temperature ?? undefined,
      topP: params.top_p ?? undefined,
      stopSequences
    }
  }

  /**
   * Extract provider-specific options from OpenAI params
   * Maps reasoning_effort to provider-specific thinking/reasoning parameters
   */
  extractProviderOptions(provider: Provider, params: ExtendedChatCompletionCreateParams): ProviderOptions | undefined {
    return mapReasoningEffortToProviderOptions(provider, params.reasoning_effort)
  }
}

export default OpenAiMessageConverter
