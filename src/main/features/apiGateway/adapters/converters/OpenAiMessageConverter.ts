/**
 * OpenAI Message Converter
 *
 * Converts OpenAI Chat Completions API format to AI SDK format.
 * Handles messages, tools, and extended features like reasoning_content.
 */

import { UnsupportedFunctionalityError, type JSONValue } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import mime from 'mime'

import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionUserMessageParam
} from '@cherrystudio/openai/resources'
import type { ChatCompletionCreateParamsBase } from '@cherrystudio/openai/resources/chat/completions'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { parseDataUrl } from '@shared/utils/dataUrl'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import {
  mergeGatewayProviderOptions,
  nativeOpenAiOptions,
  openAiOutput,
  parallelToolOptions
} from './openAiRequestOptions'
import { mapReasoningEffortToProviderOptions } from './providerOptionsMapper'
import { isBlankToolName } from './toolName'

const logger = loggerService.withContext('OpenAiMessageConverter')

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
  reasoning_details?: JSONValue[]
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
    // tool_call_id → result output.
    const toolResultOutputs = new Map<string, string>()
    for (const msg of params.messages) {
      if (msg.role === 'tool') {
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
        return this.convertAssistantMessage(msg, toolResultOutputs)
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
          const p: FileUIPart = {
            type: 'file',
            mediaType,
            url,
            ...(part.image_url.detail ? { providerMetadata: { openai: { imageDetail: part.image_url.detail } } } : {})
          }
          parts.push(p)
        } else if (part.type === 'input_audio') {
          const mediaType = part.input_audio.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
          parts.push({ type: 'file', mediaType, url: `data:${mediaType};base64,${part.input_audio.data}` })
        } else if (part.type === 'file') {
          if (part.file.file_id || !part.file.file_data) {
            throw new UnsupportedFunctionalityError({ functionality: 'Provider-bound Chat file_id; supply file_data' })
          }
          const mediaType =
            parseDataUrl(part.file.file_data)?.mediaType ??
            mime.getType(part.file.filename ?? '') ??
            'application/octet-stream'
          parts.push({
            type: 'file',
            mediaType,
            filename: part.file.filename,
            url: part.file.file_data.startsWith('data:')
              ? part.file.file_data
              : `data:${mediaType};base64,${part.file.file_data}`
          })
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
    if (msg.reasoning_content || msg.reasoning_details?.length) {
      const p: ReasoningUIPart = {
        type: 'reasoning',
        text: msg.reasoning_content ?? '',
        ...(msg.reasoning_details && { providerMetadata: { openrouter: { reasoning_details: msg.reasoning_details } } })
      }
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
        input = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
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
    const droppedTools: Array<{ index: number; path: string; name: string; description?: string | null }> = []

    for (const [index, toolDef] of tools.entries()) {
      if (toolDef.type !== 'function') {
        throw new UnsupportedFunctionalityError({ functionality: `Chat tool: ${toolDef.type}` })
      }
      if (isBlankToolName(toolDef.function.name)) {
        droppedTools.push({
          index,
          path: `tools[${index}].function.name`,
          name: toolDef.function.name,
          description: toolDef.function.description
        })
        continue
      }

      const rawSchema = toolDef.function.parameters
      const schema = rawSchema ?? { type: 'object' as const }

      const aiTool = tool({
        description: toolDef.function.description || '',
        inputSchema: jsonSchema(schema),
        ...(typeof toolDef.function.strict === 'boolean' ? { strict: toolDef.function.strict } : {})
      })

      aiSdkTools[toolDef.function.name] = aiTool
    }

    if (droppedTools.length > 0) {
      logger.warn('Dropped tools with empty or whitespace-only names before provider request', {
        inputFormat: 'openai',
        model: params.model,
        droppedTools
      })
    }

    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /**
   * Extract stream/generation options from OpenAI params
   */
  extractStreamOptions(params: ExtendedChatCompletionCreateParams): StreamTextOptions {
    if (params.n != null && params.n !== 1) {
      throw new UnsupportedFunctionalityError({ functionality: 'Multiple Chat completion candidates' })
    }
    if (params.modalities?.some((modality) => modality !== 'text') || params.audio) {
      throw new UnsupportedFunctionalityError({ functionality: 'Chat audio output' })
    }
    if (typeof params.tool_choice === 'object' && params.tool_choice?.type !== 'function') {
      throw new UnsupportedFunctionalityError({ functionality: 'Non-function Chat tool choice' })
    }
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
      stopSequences,
      seed: params.seed ?? undefined,
      frequencyPenalty: params.frequency_penalty ?? undefined,
      presencePenalty: params.presence_penalty ?? undefined,
      toolChoice:
        params.tool_choice && typeof params.tool_choice === 'object'
          ? { type: 'tool', toolName: params.tool_choice.function.name }
          : (params.tool_choice ?? undefined),
      output: openAiOutput(
        params.response_format?.type === 'json_schema'
          ? {
              type: 'json_schema',
              ...params.response_format.json_schema
            }
          : params.response_format
      )
    }
  }

  /**
   * Extract provider-specific options from OpenAI params
   * Maps reasoning_effort to provider-specific thinking/reasoning parameters
   */
  extractProviderOptions(
    provider: Provider,
    model: Model,
    params: ExtendedChatCompletionCreateParams,
    maxOutputTokens?: number,
    overrideReasoning = false
  ): ProviderOptions | undefined {
    const reasoning = overrideReasoning
      ? undefined
      : mapReasoningEffortToProviderOptions(provider, model, params.reasoning_effort, maxOutputTokens)
    const parallel = parallelToolOptions(provider, model, params.parallel_tool_calls)
    const native = nativeOpenAiOptions(provider, model, {
      ...(params.service_tier != null && { serviceTier: params.service_tier }),
      ...(params.logprobs != null && { logprobs: params.logprobs ? (params.top_logprobs ?? true) : false }),
      ...(params.response_format?.type === 'json_schema' &&
        params.response_format.json_schema.strict != null && {
          strictJsonSchema: params.response_format.json_schema.strict
        })
    })
    return mergeGatewayProviderOptions(reasoning, parallel, native)
  }
}

export default OpenAiMessageConverter
