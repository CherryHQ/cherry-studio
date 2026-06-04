/**
 * Anthropic Message Converter
 *
 * Converts Anthropic Messages API format to AI SDK format.
 * Handles messages, tools, and special content types (images, thinking, tool results).
 */

import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import type { ProviderOptions, ReasoningPart, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type {
  ImageBlockParam,
  MessageCreateParams,
  TextBlockParam,
  Tool as AnthropicTool
} from '@anthropic-ai/sdk/resources/messages'
import { isGemini3ModelId } from '@shared/aiCore/middlewares'
import type { Provider } from '@types'
import type { ImagePart, JSONValue, ModelMessage, TextPart, Tool as AiSdkTool } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './json-schema-to-zod'
import { mapAnthropicThinkingToProviderOptions } from './provider-options-mapper'

const MAGIC_STRING = 'skip_thought_signature_validator'

/**
 * Sanitize value for JSON serialization
 */
function sanitizeJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Convert Anthropic tool result content to AI SDK format
 */
function convertToolResultToAiSdk(
  content: string | Array<TextBlockParam | ImageBlockParam>
): LanguageModelV2ToolResultOutput {
  if (typeof content === 'string') {
    return { type: 'text', value: content }
  }
  const values: Array<{ type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }> = []
  for (const block of content) {
    if (block.type === 'text') {
      values.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      values.push({
        type: 'media',
        data: block.source.type === 'base64' ? block.source.data : block.source.url,
        mediaType: block.source.type === 'base64' ? block.source.media_type : 'image/png'
      })
    }
  }
  return { type: 'content', value: values }
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
   * Convert Anthropic MessageCreateParams to AI SDK ModelMessage[]
   */
  toAiSdkMessages(params: MessageCreateParams): ModelMessage[] {
    const messages: ModelMessage[] = []

    // System message
    if (params.system) {
      if (typeof params.system === 'string') {
        messages.push({ role: 'system', content: params.system })
      } else if (Array.isArray(params.system)) {
        const systemText = params.system
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
        if (systemText) {
          messages.push({ role: 'system', content: systemText })
        }
      }
    }

    // Build tool call ID to name mapping for tool results
    const toolCallIdToName = new Map<string, string>()
    for (const msg of params.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolCallIdToName.set(block.id, block.name)
          }
        }
      }
    }

    // User/assistant messages
    for (const msg of params.messages) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })
      } else if (Array.isArray(msg.content)) {
        const textParts: TextPart[] = []
        const imageParts: ImagePart[] = []
        const reasoningParts: ReasoningPart[] = []
        const toolCallParts: ToolCallPart[] = []
        const toolResultParts: ToolResultPart[] = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push({ type: 'text', text: block.text })
          } else if (block.type === 'thinking') {
            reasoningParts.push({ type: 'reasoning', text: block.thinking })
          } else if (block.type === 'redacted_thinking') {
            reasoningParts.push({ type: 'reasoning', text: block.data })
          } else if (block.type === 'image') {
            const source = block.source
            if (source.type === 'base64') {
              imageParts.push({ type: 'image', image: `data:${source.media_type};base64,${source.data}` })
            } else if (source.type === 'url') {
              imageParts.push({ type: 'image', image: source.url })
            }
          } else if (block.type === 'tool_use') {
            const options: ProviderOptions = {}
            if (isGemini3ModelId(params.model)) {
              if (this.googleReasoningCache?.get(`google-${block.name}`)) {
                options.google = {
                  thoughtSignature: MAGIC_STRING
                }
              }
            }
            if (this.openRouterReasoningCache?.get(`openrouter-${block.id}`)) {
              options.openrouter = {
                reasoning_details:
                  (sanitizeJson(this.openRouterReasoningCache.get(`openrouter-${block.id}`)) as JSONValue[]) || []
              }
            }
            toolCallParts.push({
              type: 'tool-call',
              toolName: block.name,
              toolCallId: block.id,
              input: block.input,
              providerOptions: options
            })
          } else if (block.type === 'tool_result') {
            const toolName = toolCallIdToName.get(block.tool_use_id) || 'unknown'
            toolResultParts.push({
              type: 'tool-result',
              toolCallId: block.tool_use_id,
              toolName,
              output: block.content ? convertToolResultToAiSdk(block.content) : { type: 'text', value: '' }
            })
          }
        }

        if (toolResultParts.length > 0) {
          messages.push({ role: 'tool', content: [...toolResultParts] })
        }

        if (msg.role === 'user') {
          const userContent = [...textParts, ...imageParts]
          if (userContent.length > 0) {
            messages.push({ role: 'user', content: userContent })
          }
        } else {
          const assistantContent = [...reasoningParts, ...textParts, ...toolCallParts]
          if (assistantContent.length > 0) {
            let providerOptions: ProviderOptions | undefined = undefined
            if (this.openRouterReasoningCache?.get('openrouter')) {
              providerOptions = {
                openrouter: {
                  reasoning_details:
                    (sanitizeJson(this.openRouterReasoningCache.get('openrouter')) as JSONValue[]) || []
                }
              }
            } else if (isGemini3ModelId(params.model)) {
              providerOptions = {
                google: {
                  thoughtSignature: MAGIC_STRING
                }
              }
            }
            messages.push({ role: 'assistant', content: assistantContent, providerOptions })
          }
        }
      }
    }

    return messages
  }

  /**
   * Convert Anthropic tools to AI SDK tools
   */
  toAiSdkTools(params: MessageCreateParams): Record<string, AiSdkTool> | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: Record<string, AiSdkTool> = {}
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
