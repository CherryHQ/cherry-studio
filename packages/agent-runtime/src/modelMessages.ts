import {
  type Api,
  getCurrentTools,
  type Model,
  type ToolResultMessage,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import {
  type AssistantModelMessage,
  jsonSchema,
  type ModelMessage,
  tool,
  type ToolModelMessage,
  type ToolSet
} from 'ai'

import { decodeProviderMetadata } from './providerMetadata'

type ToolResultOutput = Extract<ToolModelMessage['content'][number], { type: 'tool-result' }>['output']

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

/**
 * Pi transcript -> AI SDK messages. System messages are left to the caller's `system` prompt.
 * Pi's `transformMessages` first applies its replay rules: signatures and reasoning survive only for
 * the same provider/api/model, orphan tool calls get synthetic results, failed turns are skipped.
 */
export function toModelMessages(context: TranscriptContext, model: Model<Api>): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const message of transformMessages(context.messages, model)) {
    switch (message.role) {
      case 'system':
        break
      case 'user': {
        const parts =
          typeof message.content === 'string' ? [{ type: 'text', text: message.content } as const] : message.content
        messages.push({
          role: 'user',
          content: parts.map((part) =>
            part.type === 'text'
              ? { type: 'text' as const, text: part.text }
              : { type: 'image' as const, image: part.data, mediaType: part.mimeType }
          )
        })
        break
      }
      case 'assistant': {
        const content: Exclude<AssistantModelMessage['content'], string> = message.content.map((block) => {
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
        if (content.length > 0) messages.push({ role: 'assistant', content })
        break
      }
      case 'toolResult':
        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              output: toToolResultOutput(message)
            }
          ]
        })
        break
    }
  }
  return messages
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
