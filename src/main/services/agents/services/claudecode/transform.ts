// This file is used to transform claude code json response to aisdk streaming format

import { SDKMessage } from '@anthropic-ai/claude-code'
import { MessageParam } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import { ProviderMetadata, UIMessageChunk } from 'ai'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('ClaudeCodeTransform')

// Helper function to generate unique IDs for text blocks
const generateMessageId = (): string => {
  return `msg_${uuidv4().replace(/-/g, '')}`
}

// Helper function to extract text content from Anthropic messages
const extractTextContent = (message: MessageParam): string => {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
  }

  return ''
}

// Helper function to extract tool calls from assistant messages
const extractToolCalls = (message: any): any[] => {
  if (!message.content || !Array.isArray(message.content)) {
    return []
  }

  return message.content.filter((block: any) => block.type === 'tool_use')
}

// Main transform function
export function transformSDKMessageToUIChunk(sdkMessage: SDKMessage): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []

  switch (sdkMessage.type) {
    case 'assistant':
      chunks.push(...handleAssistantMessage(sdkMessage))
      break

    case 'user':
      chunks.push(...handleUserMessage(sdkMessage))
      break

    case 'stream_event':
      chunks.push(...handleStreamEvent(sdkMessage))
      break

    case 'system':
      chunks.push(...handleSystemMessage(sdkMessage))
      break

    case 'result':
      chunks.push(...handleResultMessage(sdkMessage))
      break

    default:
      // Handle unknown message types gracefully
      logger.warn('Unknown SDKMessage type:', { type: (sdkMessage as any).type })
      break
  }

  return chunks
}

function sdkMessageToProviderMetadata(message: SDKMessage): ProviderMetadata {
  const meta: ProviderMetadata = {
    raw: message as Record<string, any>
  }
  return meta
}

// Handle assistant messages
function handleAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  const messageId = generateMessageId()

  // Extract text content
  const textContent = extractTextContent(message.message as MessageParam)
  if (textContent) {
    chunks.push(
      {
        type: 'text-start',
        id: messageId,
        providerMetadata: {
          anthropic: {
            uuid: message.uuid,
            session_id: message.session_id
          },
          raw: sdkMessageToProviderMetadata(message)
        }
      },
      {
        type: 'text-delta',
        id: messageId,
        delta: textContent,
        providerMetadata: {
          anthropic: {
            uuid: message.uuid,
            session_id: message.session_id
          },
          raw: sdkMessageToProviderMetadata(message)
        }
      },
      {
        type: 'text-end',
        id: messageId,
        providerMetadata: {
          anthropic: {
            uuid: message.uuid,
            session_id: message.session_id
          },
          raw: sdkMessageToProviderMetadata(message)
        }
      }
    )
  }

  // Handle tool calls
  const toolCalls = extractToolCalls(message.message)
  for (const toolCall of toolCalls) {
    chunks.push({
      type: 'tool-input-available',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      providerExecuted: true
    })
  }

  return chunks
}

// Handle user messages
function handleUserMessage(message: Extract<SDKMessage, { type: 'user' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  const messageId = generateMessageId()

  const textContent = extractTextContent(message.message)
  if (textContent) {
    chunks.push(
      {
        type: 'text-start',
        id: messageId,
        providerMetadata: {
          anthropic: {
            session_id: message.session_id,
            role: 'user'
          }
        }
      },
      {
        type: 'text-delta',
        id: messageId,
        delta: textContent,
        providerMetadata: {
          anthropic: {
            session_id: message.session_id,
            role: 'user'
          }
        }
      },
      {
        type: 'text-end',
        id: messageId,
        providerMetadata: {
          anthropic: {
            session_id: message.session_id,
            role: 'user'
          }
        }
      }
    )
  }

  return chunks
}

// Handle stream events (real-time streaming)
function handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  const event = message.event

  switch (event.type) {
    case 'message_start':
      // No specific UI chunk needed for message start in this protocol
      break

    case 'content_block_start':
      if (event.content_block?.type === 'text') {
        chunks.push({
          type: 'text-start',
          id: event.index?.toString() || generateMessageId(),
          providerMetadata: {
            anthropic: {
              uuid: message.uuid,
              session_id: message.session_id,
              content_block_index: event.index
            },
            raw: sdkMessageToProviderMetadata(message)
          }
        })
      } else if (event.content_block?.type === 'tool_use') {
        chunks.push({
          type: 'tool-input-start',
          toolCallId: event.content_block.id,
          toolName: event.content_block.name,
          providerExecuted: true
        })
      }
      break

    case 'content_block_delta':
      if (event.delta?.type === 'text_delta') {
        chunks.push({
          type: 'text-delta',
          id: event.index?.toString() || generateMessageId(),
          delta: event.delta.text,
          providerMetadata: {
            anthropic: {
              uuid: message.uuid,
              session_id: message.session_id,
              content_block_index: event.index
            },
            raw: sdkMessageToProviderMetadata(message)
          }
        })
      } else if (event.delta?.type === 'input_json_delta') {
        chunks.push({
          type: 'tool-input-delta',
          toolCallId: (event as any).content_block?.id || '',
          inputTextDelta: event.delta.partial_json
        })
      }
      break

    case 'content_block_stop': {
      // Determine if this was a text block or tool use block
      const blockId = event.index?.toString() || generateMessageId()
      chunks.push({
        type: 'text-end',
        id: blockId,
        providerMetadata: {
          anthropic: {
            uuid: message.uuid,
            session_id: message.session_id,
            content_block_index: event.index
          },
          raw: sdkMessageToProviderMetadata(message)
        }
      })
      break
    }

    case 'message_delta':
      // Handle usage updates or other message-level deltas
      break

    case 'message_stop':
      // This could signal the end of the message
      break

    default:
      logger.warn('Unknown stream event type:', { type: (event as any).type })
      break
  }

  return chunks
}

// Handle system messages
function handleSystemMessage(message: Extract<SDKMessage, { type: 'system' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []

  if (message.subtype === 'init') {
    // System initialization - could emit as a data chunk or skip
    chunks.push({
      type: 'data-system' as any,
      data: {
        type: 'init',
        cwd: message.cwd,
        tools: message.tools,
        model: message.model,
        mcp_servers: message.mcp_servers,
        raw: message
      }
    })
  } else if (message.subtype === 'compact_boundary') {
    chunks.push({
      type: 'data-system' as any,
      data: {
        type: 'compact_boundary',
        metadata: message.compact_metadata,
        raw: message
      }
    })
  }

  return chunks
}

// Handle result messages (completion with usage stats)
function handleResultMessage(message: Extract<SDKMessage, { type: 'result' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []

  if (message.subtype === 'success') {
    // Emit the final result text if available
    if (message.result) {
      const messageId = generateMessageId()
      chunks.push(
        {
          type: 'text-start',
          id: messageId,
          providerMetadata: {
            anthropic: {
              uuid: message.uuid,
              session_id: message.session_id,
              final_result: true
            },
            raw: sdkMessageToProviderMetadata(message)
          }
        },
        {
          type: 'text-delta',
          id: messageId,
          delta: message.result,
          providerMetadata: {
            anthropic: {
              uuid: message.uuid,
              session_id: message.session_id,
              final_result: true
            },
            raw: sdkMessageToProviderMetadata(message)
          }
        },
        {
          type: 'text-end',
          id: messageId,
          providerMetadata: {
            anthropic: {
              uuid: message.uuid,
              session_id: message.session_id,
              final_result: true
            },
            raw: sdkMessageToProviderMetadata(message)
          }
        }
      )
    }

    // Emit usage and cost data
    chunks.push({
      type: 'data-usage' as any,
      data: {
        duration_ms: message.duration_ms,
        duration_api_ms: message.duration_api_ms,
        num_turns: message.num_turns,
        total_cost_usd: message.total_cost_usd,
        usage: message.usage,
        modelUsage: message.modelUsage,
        permission_denials: message.permission_denials
      }
    })
  } else {
    // Handle error cases
    chunks.push({
      type: 'error',
      errorText: `${message.subtype}: Process failed after ${message.num_turns} turns`
    })

    // Still emit usage data for failed requests
    chunks.push({
      type: 'data-usage' as any,
      data: {
        duration_ms: message.duration_ms,
        duration_api_ms: message.duration_api_ms,
        num_turns: message.num_turns,
        total_cost_usd: message.total_cost_usd,
        usage: message.usage,
        modelUsage: message.modelUsage,
        permission_denials: message.permission_denials
      }
    })
  }

  return chunks
}

// Convenience function to transform a stream of SDKMessages
export function* transformSDKMessageStream(sdkMessages: SDKMessage[]): Generator<UIMessageChunk> {
  for (const sdkMessage of sdkMessages) {
    const chunks = transformSDKMessageToUIChunk(sdkMessage)
    for (const chunk of chunks) {
      yield chunk
    }
  }
}

// Async version for async iterables
export async function* transformSDKMessageStreamAsync(
  sdkMessages: AsyncIterable<SDKMessage>
): AsyncGenerator<UIMessageChunk> {
  for await (const sdkMessage of sdkMessages) {
    const chunks = transformSDKMessageToUIChunk(sdkMessage)
    for (const chunk of chunks) {
      yield chunk
    }
  }
}
