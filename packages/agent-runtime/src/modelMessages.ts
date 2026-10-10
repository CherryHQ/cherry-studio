import {
  type Api,
  type AssistantMessage,
  getCurrentTools,
  type ImageContent,
  type JsonObject,
  type Message,
  type Model,
  type TextContent,
  type ToolResultMessage,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import {
  type AssistantModelMessage,
  jsonSchema,
  type ProviderMetadata,
  tool,
  type ToolModelMessage,
  type ToolSet,
  type UserModelMessage
} from 'ai'

import { decodeProviderMetadata, encodeProviderMetadata } from './providerMetadata'
import { TranscriptError } from './transcript'

type ToolResultOutput = Extract<ToolModelMessage['content'][number], { type: 'tool-result' }>['output']
type PiUserContent = string | (TextContent | ImageContent)[]
export type ConversationModelMessage = UserModelMessage | AssistantModelMessage | ToolModelMessage

function toToolResultOutput(message: ToolResultMessage): ToolResultOutput {
  if (message.content.some((part) => part.type === 'image')) {
    return {
      type: 'content',
      value: message.content.map((part) =>
        part.type === 'text'
          ? { type: 'text' as const, text: part.text }
          : { type: 'image-data' as const, data: part.data, mediaType: part.mimeType }
      )
    }
  }
  const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  return message.isError ? { type: 'error-text', value: text } : { type: 'text', value: text }
}

export function toUserContent(content: PiUserContent): UserModelMessage['content'] {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image' as const, image: part.data, mediaType: part.mimeType }
  )
}

/**
 * One Pi message in AI SDK form. The transcript stores exactly what the bridge sends, so the two
 * cannot drift. System messages are prompt state, not conversation.
 */
export function toModelMessage(message: Message): ConversationModelMessage | undefined {
  switch (message.role) {
    case 'system':
      return undefined
    case 'user':
      return { role: 'user', content: toUserContent(message.content) }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content.map((block) => {
          switch (block.type) {
            case 'text':
              return { type: 'text', text: block.text, providerOptions: decodeProviderMetadata(block.textSignature) }
            case 'thinking':
              return {
                type: 'reasoning',
                text: block.thinking,
                providerOptions: decodeProviderMetadata(block.thinkingSignature)
              }
            case 'toolCall':
              return {
                type: 'tool-call',
                toolCallId: block.id,
                toolName: block.name,
                input: block.arguments,
                providerOptions: decodeProviderMetadata(block.thoughtSignature)
              }
          }
        })
      }
    case 'toolResult':
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: toToolResultOutput(message)
          }
        ]
      }
  }
}

/**
 * Pi transcript -> AI SDK messages. System messages are left to the caller's `system` prompt.
 * Pi's `transformMessages` first applies its replay rules: signatures and reasoning survive only for
 * the same provider/api/model, orphan tool calls get synthetic results, failed turns are skipped.
 */
export function toModelMessages(messages: Message[], model: Model<Api>): ConversationModelMessage[] {
  return transformMessages(messages, model).flatMap((piMessage) => {
    const message = toModelMessage(piMessage)
    if (!message || (message.role === 'assistant' && message.content.length === 0)) return []
    return [message]
  })
}

export function toToolSet(context: TranscriptContext): ToolSet {
  return Object.fromEntries(
    getCurrentTools(context.messages).map((piTool) => [
      piTool.name,
      // TypeBox schemas are JSON Schema; the round trip drops TypeBox's symbol keys.
      tool({ description: piTool.description, inputSchema: jsonSchema(JSON.parse(JSON.stringify(piTool.parameters))) })
    ])
  )
}

// AI SDK form -> Pi content, for messages rebuilt from a transcript. Only the forms
// `toModelMessage` produces are accepted; anything else fails closed.

const unsupported = (entryId: string, what: string) =>
  new TranscriptError('unsupported_content', entryId, `Unsupported transcript content: ${what}`)

/** The Pi signature slot holding a part's provider options, or nothing. */
function signatureSlot<K extends string>(key: K, options: ProviderMetadata | undefined): { [P in K]?: string } {
  const encoded = encodeProviderMetadata(options)
  return (encoded === undefined ? {} : { [key]: encoded }) as { [P in K]?: string }
}

export function toPiUserContent(content: UserModelMessage['content'], entryId: string): PiUserContent {
  if (typeof content === 'string') return content
  return content.map((part): TextContent | ImageContent => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image' && typeof part.image === 'string' && part.mediaType)
      return { type: 'image', data: part.image, mimeType: part.mediaType }
    throw unsupported(entryId, `user part ${part.type} (images must be base64 strings with a media type)`)
  })
}

export function toPiAssistantContent(
  content: AssistantModelMessage['content'],
  entryId: string
): AssistantMessage['content'] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content.map((part): AssistantMessage['content'][number] => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text, ...signatureSlot('textSignature', part.providerOptions) }
      case 'reasoning':
        return { type: 'thinking', thinking: part.text, ...signatureSlot('thinkingSignature', part.providerOptions) }
      case 'tool-call': {
        const input = part.input
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          throw unsupported(entryId, 'tool-call input that is not an object')
        return {
          type: 'toolCall',
          id: part.toolCallId,
          name: part.toolName,
          arguments: input as JsonObject,
          ...signatureSlot('thoughtSignature', part.providerOptions)
        }
      }
      default:
        throw unsupported(entryId, `assistant part ${part.type}`)
    }
  })
}

export function toPiToolResult(
  message: ToolModelMessage,
  entryId: string
): Pick<ToolResultMessage, 'toolCallId' | 'toolName' | 'content' | 'isError'> {
  const [part, ...rest] = message.content
  if (!part || rest.length > 0 || part.type !== 'tool-result')
    throw unsupported(entryId, 'a tool message must hold exactly one tool-result part')
  const { output } = part
  const result = { toolCallId: part.toolCallId, toolName: part.toolName }
  switch (output.type) {
    case 'text':
    case 'error-text':
      return { ...result, content: [{ type: 'text', text: output.value }], isError: output.type === 'error-text' }
    case 'content':
      return {
        ...result,
        isError: false,
        content: output.value.map((item): TextContent | ImageContent => {
          if (item.type === 'text') return { type: 'text', text: item.text }
          if (item.type === 'image-data') return { type: 'image', data: item.data, mimeType: item.mediaType }
          throw unsupported(entryId, `tool output item ${item.type}`)
        })
      }
    default:
      throw unsupported(entryId, `tool output ${output.type}`)
  }
}
