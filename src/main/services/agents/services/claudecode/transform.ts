// This file is used to transform claude code json response to aisdk streaming format

import type { LanguageModelV2Usage } from '@ai-sdk/provider'
import { SDKMessage } from '@anthropic-ai/claude-code'
import { loggerService } from '@logger'
import type { ClaudeCodeRawValue } from '@shared/agents/claudecode/types'
import type { ProviderMetadata, TextStreamPart } from 'ai'
import { v4 as uuidv4 } from 'uuid'

import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason'

const logger = loggerService.withContext('ClaudeCodeTransform')

type AgentStreamPart = TextStreamPart<Record<string, any>>

const contentBlockState = new Map<
  string,
  {
    type: 'text' | 'tool-call'
    toolCallId?: string
    toolName?: string
    input?: string
  }
>()

// Helper function to generate unique IDs for text blocks
const generateMessageId = (): string => `msg_${uuidv4().replace(/-/g, '')}`

// Main transform function
export function transformSDKMessageToStreamParts(sdkMessage: SDKMessage): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  logger.debug('Transforming SDKMessage to stream parts', sdkMessage)
  switch (sdkMessage.type) {
    case 'assistant':
    case 'user':
      chunks.push(...handleUserOrAssistantMessage(sdkMessage))
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
      logger.warn('Unknown SDKMessage type:', { type: (sdkMessage as any).type })
      break
  }

  return chunks
}

const sdkMessageToProviderMetadata = (message: SDKMessage): ProviderMetadata => {
  return {
    anthropic: {
      uuid: message.uuid || generateMessageId(),
      session_id: message.session_id
    },
    raw: message as Record<string, any>
  }
}

function generateTextChunks(id: string, text: string, message: SDKMessage): AgentStreamPart[] {
  const providerMetadata = sdkMessageToProviderMetadata(message)
  return [
    {
      type: 'text-start',
      id
    },
    {
      type: 'text-delta',
      id,
      text
    },
    {
      type: 'text-end',
      id,
      providerMetadata: {
        ...providerMetadata
      }
    }
  ]
}

function handleUserOrAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' | 'user' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  const messageId = message.uuid?.toString() || generateMessageId()

  // handle normal text content
  if (typeof message.message.content === 'string') {
    const textContent = message.message.content
    if (textContent) {
      chunks.push(...generateTextChunks(messageId, textContent, message))
    }
  } else if (Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      switch (block.type) {
        case 'text':
          chunks.push(...generateTextChunks(messageId, block.text, message))
          break
        case 'tool_use':
          chunks.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
            providerExecuted: true,
            providerMetadata: sdkMessageToProviderMetadata(message)
          })
          break
        case 'tool_result':
          chunks.push({
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            toolName: contentBlockState[block.tool_use_id].toolName,
            input: '',
            output: block.content
          })
          break
        default:
          logger.warn('Unknown content block type in user/assistant message:', {
            type: block.type
          })
          chunks.push({
            type: 'raw',
            rawValue: block
          })
          break
      }
    }
  }

  return chunks
}

// Handle stream events (real-time streaming)
function handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  const event = message.event
  const blockKey = `${message.uuid ?? message.session_id ?? 'session'}:${event.type}`
  logger.debug('Handling stream event:', { event })
  switch (event.type) {
    case 'message_start':
      // No specific UI chunk needed for message start in this protocol
      break

    case 'content_block_start':
      switch (event.content_block.type) {
        case 'text': {
          contentBlockState.set(blockKey, { type: 'text' })
          chunks.push({
            type: 'text-start',
            id: String(event.index),
            providerMetadata: {
              ...sdkMessageToProviderMetadata(message),
              anthropic: {
                uuid: message.uuid,
                session_id: message.session_id,
                content_block_index: event.index
              }
            }
          })
          break
        }
        case 'tool_use': {
          contentBlockState.set(event.content_block.id, {
            type: 'tool-call',
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
            input: ''
          })
          chunks.push({
            type: 'tool-call',
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
            input: event.content_block.input,
            providerExecuted: true,
            providerMetadata: sdkMessageToProviderMetadata(message)
          })
          break
        }
      }
      break
    case 'content_block_delta':
      switch (event.delta.type) {
        case 'text_delta': {
          chunks.push({
            type: 'text-delta',
            id: String(event.index),
            text: event.delta.text,
            providerMetadata: {
              ...sdkMessageToProviderMetadata(message),
              anthropic: {
                uuid: message.uuid,
                session_id: message.session_id,
                content_block_index: event.index
              }
            }
          })
          break
        }
        // case 'thinking_delta': {
        //   chunks.push({
        //     type: 'reasoning-delta',
        //     id: String(event.index),
        //     text: event.delta.thinking,
        //   });
        //   break
        // }
        // case 'signature_delta': {
        //   if (blockType === 'thinking') {
        //     chunks.push({
        //       type: 'reasoning-delta',
        //       id: String(event.index),
        //       text: '',
        //       providerMetadata: {
        //         ...sdkMessageToProviderMetadata(message),
        //         anthropic: {
        //           uuid: message.uuid,
        //           session_id: message.session_id,
        //           content_block_index: event.index,
        //           signature: event.delta.signature
        //         }
        //       }
        //     })
        //   }
        //   break
        // }
        case 'input_json_delta': {
          const contentBlock = contentBlockState.get(blockKey)
          if (contentBlock && contentBlock.type === 'tool-call') {
            contentBlockState.set(blockKey, {
              ...contentBlock,
              input: `${contentBlock.input ?? ''}${event.delta.partial_json ?? ''}`
            })
          }
          break
        }
      }
      break

    case 'content_block_stop':
      {
        const contentBlock = contentBlockState.get(blockKey)
        if (contentBlock?.type === 'text') {
          chunks.push({
            type: 'text-end',
            id: String(event.index)
          })
        }
        contentBlockState.delete(blockKey)
      }
      break
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
function handleSystemMessage(message: Extract<SDKMessage, { type: 'system' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  logger.debug('Received system message', {
    subtype: message.subtype
  })
  switch (message.subtype) {
    case 'init': {
      chunks.push({
        type: 'start'
      })
      const rawValue: ClaudeCodeRawValue = {
        type: 'init',
        session_id: message.session_id,
        slash_commands: message.slash_commands,
        tools: message.tools,
        raw: message
      }
      chunks.push({
        type: 'raw',
        rawValue
      })
    }
  }
  return chunks
}

// Handle result messages (completion with usage stats)
function handleResultMessage(message: Extract<SDKMessage, { type: 'result' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []

  let usage: LanguageModelV2Usage | undefined
  if ('usage' in message) {
    usage = {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0)
    }
  }
  if (message.subtype === 'success') {
    chunks.push({
      type: 'finish',
      totalUsage: usage,
      finishReason: mapClaudeCodeFinishReason(message.subtype),
      providerMetadata: {
        ...sdkMessageToProviderMetadata(message),
        usage: message.usage,
        durationMs: message.duration_ms,
        costUsd: message.total_cost_usd,
        raw: message
      }
    } as AgentStreamPart)
  } else {
    chunks.push({
      type: 'error',
      error: {
        message: `${message.subtype}: Process failed after ${message.num_turns} turns`
      }
    } as AgentStreamPart)
  }
  return chunks
}
