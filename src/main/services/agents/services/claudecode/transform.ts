/**
 * Translates Anthropic Claude Code streaming messages into the generic AiSDK stream
 * parts that the agent runtime understands. The transformer coordinates batched
 * text/tool payloads, keeps per-message state using {@link ClaudeStreamState},
 * and normalises usage metadata and finish reasons so downstream consumers do
 * not need to reason about Anthropic-specific payload shapes.
 *
 * Stream lifecycle cheatsheet (per Claude turn):
 *   1. `stream_event.message_start`       → emit `start-step` and mark the state as active.
 *   2. `content_block_start` (by index)   → open a stateful block; emits one of
 *        `text-start` | `reasoning-start` | `tool-input-start`.
 *   3. `content_block_delta`              → append incremental text / reasoning / tool JSON,
 *        emitting only the delta to minimise UI churn.
 *   4. `content_block_stop`               → emit the matching `*-end` event and release the block.
 *   5. `message_delta`                    → capture usage + stop reason but defer emission.
 *   6. `message_stop`                     → emit `finish-step` with cached usage & reason, then reset.
 *   7. Assistant snapshots with `tool_use` finalise the tool block (`tool-call`).
 *   8. User snapshots with `tool_result` emit `tool-result`/`tool-error` using the cached payload.
 *   9. Assistant snapshots with plain text (when no stream events were provided) fall back to
 *        emitting `text-*` parts and a synthetic `finish-step`.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BetaStopReason } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { loggerService } from '@logger'
import type { FinishReason, LanguageModelUsage, ProviderMetadata, TextStreamPart } from 'ai'
import { v4 as uuidv4 } from 'uuid'

import { ClaudeStreamState } from './claude-stream-state'
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason'

const logger = loggerService.withContext('ClaudeCodeTransform')

type AgentStreamPart = TextStreamPart<Record<string, any>>

type ToolUseContent = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

type ToolResultContent = {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

/**
 * Maps Anthropic stop reasons to the AiSDK equivalents so higher level
 * consumers can treat completion states uniformly across providers.
 */
const finishReasonMapping: Record<BetaStopReason, FinishReason> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool-calls',
  pause_turn: 'unknown',
  refusal: 'content-filter'
}

const emptyUsage: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0
}

/**
 * Generates deterministic-ish message identifiers that are compatible with the
 * AiSDK text stream contract. Anthropic deltas sometimes omit ids, so we create
 * our own to ensure the downstream renderer can stitch chunks together.
 */
const generateMessageId = (): string => `msg_${uuidv4().replace(/-/g, '')}`

/**
 * Removes any local command stdout/stderr XML wrappers that should never surface to the UI.
 */
export const stripLocalCommandTags = (text: string): string => {
  return text.replace(/<local-command-(stdout|stderr)>(.*?)<\/local-command-\1>/gs, '$2')
}

/**
 * Filters out command-* tags from text content to prevent internal command
 * messages from appearing in the user-facing UI.
 * Removes tags like <command-message>...</command-message> and <command-name>...</command-name>
 */
const filterCommandTags = (text: string): string => {
  const withoutLocalCommandTags = stripLocalCommandTags(text)
  return withoutLocalCommandTags.replace(/<command-[^>]+>.*?<\/command-[^>]+>/gs, '').trim()
}

/**
 * Extracts provider metadata from the raw Claude message so we can surface it
 * on every emitted stream part for observability and debugging purposes.
 */
const sdkMessageToProviderMetadata = (message: SDKMessage): ProviderMetadata => {
  return {
    anthropic: {
      uuid: message.uuid || generateMessageId(),
      session_id: message.session_id
    },
    raw: message as Record<string, any>
  }
}

/**
 * Central entrypoint that receives Claude Code websocket events and converts
 * them into AiSDK `TextStreamPart`s. The state machine tracks outstanding
 * blocks across calls so that incremental deltas can be correlated correctly.
 */
export function transformSDKMessageToStreamParts(sdkMessage: SDKMessage, state: ClaudeStreamState): AgentStreamPart[] {
  logger.silly('Transforming SDKMessage', { message: JSON.stringify(sdkMessage) })
  switch (sdkMessage.type) {
    case 'assistant':
      return handleAssistantMessage(sdkMessage, state)
    case 'user':
      return handleUserMessage(sdkMessage, state)
    case 'stream_event':
      return handleStreamEvent(sdkMessage, state)
    case 'system':
      return handleSystemMessage(sdkMessage)
    case 'result':
      return handleResultMessage(sdkMessage)
    default:
      logger.warn('Unknown SDKMessage type', { type: (sdkMessage as any).type })
      return []
  }
}

/**
 * Handles aggregated assistant messages that arrive outside of the streaming
 * protocol (e.g. after a tool call finishes). We emit the appropriate
 * text/tool events and close the active step once the payload is fully
 * processed.
 */
function handleAssistantMessage(
  message: Extract<SDKMessage, { type: 'assistant' }>,
  state: ClaudeStreamState
): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  const providerMetadata = sdkMessageToProviderMetadata(message)
  const content = message.message.content
  const isStreamingActive = state.hasActiveStep()

  if (typeof content === 'string') {
    const sanitizedContent = stripLocalCommandTags(content)
    if (!sanitizedContent) {
      return chunks
    }

    if (!isStreamingActive) {
      state.beginStep()
      chunks.push({
        type: 'start-step',
        request: { body: '' },
        warnings: []
      })
    }

    const textId = message.uuid?.toString() || generateMessageId()
    chunks.push({
      type: 'text-start',
      id: textId,
      providerMetadata
    })
    chunks.push({
      type: 'text-delta',
      id: textId,
      text: sanitizedContent,
      providerMetadata
    })
    chunks.push({
      type: 'text-end',
      id: textId,
      providerMetadata
    })
    return finalizeNonStreamingStep(message, state, chunks)
  }

  if (!Array.isArray(content)) {
    return chunks
  }

  const textBlocks: string[] = []

  for (const block of content) {
    switch (block.type) {
      case 'text': {
        const sanitizedText = stripLocalCommandTags(block.text)
        if (sanitizedText) {
          textBlocks.push(sanitizedText)
        }
        break
      }
      case 'tool_use':
        handleAssistantToolUse(block as ToolUseContent, providerMetadata, state, chunks)
        break
      default:
        logger.warn('Unhandled assistant content block', { type: (block as any).type })
        break
    }
  }

  if (textBlocks.length === 0) {
    return chunks
  }

  const combinedText = textBlocks.join('')
  if (!combinedText) {
    return chunks
  }

  if (!isStreamingActive) {
    const id = message.uuid?.toString() || generateMessageId()
    state.beginStep()
    chunks.push({
      type: 'start-step',
      request: { body: '' },
      warnings: []
    })
    chunks.push({
      type: 'text-start',
      id,
      providerMetadata
    })
    chunks.push({
      type: 'text-delta',
      id,
      text: combinedText,
      providerMetadata
    })
    chunks.push({
      type: 'text-end',
      id,
      providerMetadata
    })
    return finalizeNonStreamingStep(message, state, chunks)
  }

  const existingTextBlock = state.getFirstOpenTextBlock()
  const fallbackId = existingTextBlock?.id || message.uuid?.toString() || generateMessageId()
  if (!existingTextBlock) {
    chunks.push({
      type: 'text-start',
      id: fallbackId,
      providerMetadata
    })
  }
  chunks.push({
    type: 'text-delta',
    id: fallbackId,
    text: combinedText,
    providerMetadata
  })
  chunks.push({
    type: 'text-end',
    id: fallbackId,
    providerMetadata
  })
  return finalizeNonStreamingStep(message, state, chunks)
}

/**
 * Registers tool invocations with the stream state so that later tool results
 * can be matched with the originating call.
 */
function handleAssistantToolUse(
  block: ToolUseContent,
  providerMetadata: ProviderMetadata,
  state: ClaudeStreamState,
  chunks: AgentStreamPart[]
): void {
  chunks.push({
    type: 'tool-call',
    toolCallId: block.id,
    toolName: block.name,
    input: block.input,
    providerExecuted: true,
    providerMetadata
  })
  state.completeToolBlock(block.id, block.name, block.input, providerMetadata)
}

/**
 * Emits the terminating `finish-step` frame for non-streamed responses and
 * clears the currently active step in the state tracker.
 */
function finalizeNonStreamingStep(
  message: Extract<SDKMessage, { type: 'assistant' }>,
  state: ClaudeStreamState,
  chunks: AgentStreamPart[]
): AgentStreamPart[] {
  const usage = calculateUsageFromMessage(message)
  const finishReason = inferFinishReason(message.message.stop_reason)
  chunks.push({
    type: 'finish-step',
    response: {
      id: message.uuid,
      timestamp: new Date(),
      modelId: message.message.model ?? ''
    },
    usage: usage ?? emptyUsage,
    finishReason,
    providerMetadata: sdkMessageToProviderMetadata(message)
  })
  state.resetStep()
  return chunks
}

/**
 * Converts user-originated websocket frames (text, tool results, etc.) into
 * the AiSDK format. Tool results are matched back to pending tool calls via the
 * shared `ClaudeStreamState` instance.
 */
function handleUserMessage(
  message: Extract<SDKMessage, { type: 'user' }>,
  state: ClaudeStreamState
): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  const providerMetadata = sdkMessageToProviderMetadata(message)
  const content = message.message.content
  const isSynthetic = message.isSynthetic ?? false
  if (typeof content === 'string') {
    if (!content) {
      return chunks
    }

    const filteredContent = filterCommandTags(content)
    if (!filteredContent) {
      return chunks
    }

    const id = message.uuid?.toString() || generateMessageId()
    chunks.push({
      type: 'text-start',
      id,
      providerMetadata
    })
    chunks.push({
      type: 'text-delta',
      id,
      text: filteredContent,
      providerMetadata
    })
    chunks.push({
      type: 'text-end',
      id,
      providerMetadata
    })
    return chunks
  }

  if (!Array.isArray(content)) {
    return chunks
  }

  for (const block of content) {
    if (block.type === 'tool_result') {
      const toolResult = block as ToolResultContent
      const pendingCall = state.consumePendingToolCall(toolResult.tool_use_id)
      if (toolResult.is_error) {
        chunks.push({
          type: 'tool-error',
          toolCallId: toolResult.tool_use_id,
          toolName: pendingCall?.toolName ?? 'unknown',
          input: pendingCall?.input,
          error: toolResult.content,
          providerExecuted: true
        } as AgentStreamPart)
      } else {
        chunks.push({
          type: 'tool-result',
          toolCallId: toolResult.tool_use_id,
          toolName: pendingCall?.toolName ?? 'unknown',
          input: pendingCall?.input,
          output: toolResult.content,
          providerExecuted: true
        })
      }
    } else if (block.type === 'text' && !isSynthetic) {
      const rawText = (block as { text: string }).text
      const filteredText = filterCommandTags(rawText)

      // Only push text chunks if there's content after filtering
      if (filteredText) {
        const id = message.uuid?.toString() || generateMessageId()
        chunks.push({
          type: 'text-start',
          id,
          providerMetadata
        })
        chunks.push({
          type: 'text-delta',
          id,
          text: filteredText,
          providerMetadata
        })
        chunks.push({
          type: 'text-end',
          id,
          providerMetadata
        })
      }
    } else {
      logger.warn('Unhandled user content block', { type: (block as any).type })
    }
  }

  return chunks
}

/**
 * Handles the fine-grained real-time streaming protocol where Anthropic emits
 * discrete events for message lifecycle, content blocks, and usage deltas.
 */
function handleStreamEvent(
  message: Extract<SDKMessage, { type: 'stream_event' }>,
  state: ClaudeStreamState
): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  const providerMetadata = sdkMessageToProviderMetadata(message)
  const { event } = message

  switch (event.type) {
    case 'message_start':
      state.beginStep()
      chunks.push({
        type: 'start-step',
        request: { body: '' },
        warnings: []
      })
      break

    case 'content_block_start':
      handleContentBlockStart(event.index, event.content_block, providerMetadata, state, chunks)
      break

    case 'content_block_delta':
      handleContentBlockDelta(event.index, event.delta, providerMetadata, state, chunks)
      break

    case 'content_block_stop': {
      const block = state.closeBlock(event.index)
      if (!block) {
        logger.warn('Received content_block_stop for unknown index', { index: event.index })
        break
      }

      switch (block.kind) {
        case 'text':
          chunks.push({
            type: 'text-end',
            id: block.id,
            providerMetadata
          })
          break
        case 'reasoning':
          chunks.push({
            type: 'reasoning-end',
            id: block.id,
            providerMetadata
          })
          break
        case 'tool':
          chunks.push({
            type: 'tool-input-end',
            id: block.toolCallId,
            providerMetadata
          })
          break
        default:
          break
      }
      break
    }

    case 'message_delta': {
      const finishReason = event.delta.stop_reason
        ? mapStopReason(event.delta.stop_reason as BetaStopReason)
        : undefined
      const usage = convertUsage(event.usage)
      state.setPendingUsage(usage, finishReason)
      break
    }

    case 'message_stop': {
      if (!state.hasActiveStep()) {
        break
      }
      const pending = state.getPendingUsage()
      chunks.push({
        type: 'finish-step',
        response: {
          id: message.uuid,
          timestamp: new Date(),
          modelId: ''
        },
        usage: pending.usage ?? emptyUsage,
        finishReason: pending.finishReason ?? 'stop',
        providerMetadata
      })
      state.resetStep()
      break
    }

    default:
      logger.warn('Unknown stream event type', { type: (event as any).type })
      break
  }

  return chunks
}

/**
 * Opens the appropriate block type when Claude starts streaming a new content
 * section so later deltas know which logical entity to append to.
 */
function handleContentBlockStart(
  index: number,
  contentBlock: any,
  providerMetadata: ProviderMetadata,
  state: ClaudeStreamState,
  chunks: AgentStreamPart[]
): void {
  switch (contentBlock.type) {
    case 'text': {
      const block = state.openTextBlock(index, generateMessageId())
      chunks.push({
        type: 'text-start',
        id: block.id,
        providerMetadata
      })
      break
    }
    case 'thinking':
    case 'redacted_thinking': {
      const block = state.openReasoningBlock(index, generateMessageId(), contentBlock.type === 'redacted_thinking')
      chunks.push({
        type: 'reasoning-start',
        id: block.id,
        providerMetadata
      })
      break
    }
    case 'tool_use': {
      const block = state.openToolBlock(index, {
        toolCallId: contentBlock.id,
        toolName: contentBlock.name,
        providerMetadata
      })
      chunks.push({
        type: 'tool-input-start',
        id: block.toolCallId,
        toolName: block.toolName,
        providerMetadata
      })
      break
    }
    default:
      logger.warn('Unhandled content_block_start type', { type: contentBlock.type })
      break
  }
}

/**
 * Applies incremental deltas to the active block (text, thinking, tool input)
 * and emits the translated AiSDK chunk immediately.
 */
function handleContentBlockDelta(
  index: number,
  delta: any,
  providerMetadata: ProviderMetadata,
  state: ClaudeStreamState,
  chunks: AgentStreamPart[]
): void {
  switch (delta.type) {
    case 'text_delta': {
      const block = state.appendTextDelta(index, delta.text)
      if (!block) {
        logger.warn('Received text_delta for unknown block', { index })
        return
      }
      block.text = stripLocalCommandTags(block.text)
      if (!block.text) {
        break
      }
      chunks.push({
        type: 'text-delta',
        id: block.id,
        text: block.text,
        providerMetadata
      })
      break
    }
    case 'thinking_delta': {
      const block = state.appendReasoningDelta(index, delta.thinking)
      if (!block) {
        logger.warn('Received thinking_delta for unknown block', { index })
        return
      }
      chunks.push({
        type: 'reasoning-delta',
        id: block.id,
        text: delta.thinking,
        providerMetadata
      })
      break
    }
    case 'signature_delta': {
      const block = state.getBlock(index)
      if (block && block.kind === 'reasoning') {
        chunks.push({
          type: 'reasoning-delta',
          id: block.id,
          text: '',
          providerMetadata
        })
      }
      break
    }
    case 'input_json_delta': {
      const block = state.appendToolInputDelta(index, delta.partial_json)
      if (!block) {
        logger.warn('Received input_json_delta for unknown block', { index })
        return
      }
      chunks.push({
        type: 'tool-input-delta',
        id: block.toolCallId,
        delta: block.inputBuffer,
        providerMetadata
      })
      break
    }
    default:
      logger.warn('Unhandled content_block_delta type', { type: delta.type })
      break
  }
}

/**
 * System messages currently only deliver the session bootstrap payload. We
 * forward it as both a `start` marker and a raw snapshot for diagnostics.
 */
function handleSystemMessage(message: Extract<SDKMessage, { type: 'system' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []
  if (message.subtype === 'init') {
    chunks.push({
      type: 'start'
    })
    chunks.push({
      type: 'raw',
      rawValue: {
        type: 'init',
        session_id: message.session_id,
        slash_commands: message.slash_commands,
        tools: message.tools,
        raw: message
      }
    })
  } else if (message.subtype === 'compact_boundary') {
    chunks.push({
      type: 'raw',
      rawValue: {
        type: 'compact',
        session_id: message.session_id,
        raw: message
      }
    })
  }
  return chunks
}

/**
 * Terminal result messages arrive once the Claude Code session concludes.
 * Successful runs yield a `finish` frame with aggregated usage metrics, while
 * failures are surfaced as `error` frames.
 */
function handleResultMessage(message: Extract<SDKMessage, { type: 'result' }>): AgentStreamPart[] {
  const chunks: AgentStreamPart[] = []

  let usage: LanguageModelUsage | undefined
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
      totalUsage: usage ?? emptyUsage,
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

/**
 * Normalises usage payloads so the caller always receives numeric values even
 * when the provider omits certain fields.
 */
function convertUsage(
  usage?: {
    input_tokens?: number | null
    output_tokens?: number | null
  } | null
): LanguageModelUsage | undefined {
  if (!usage) {
    return undefined
  }
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  }
}

/**
 * Anthropic-only wrapper around {@link finishReasonMapping} that defaults to
 * `unknown` to avoid surprising downstream consumers when new stop reasons are
 * introduced.
 */
function mapStopReason(reason: BetaStopReason): FinishReason {
  return finishReasonMapping[reason] ?? 'unknown'
}

/**
 * Extracts token accounting details from an assistant message, if available.
 */
function calculateUsageFromMessage(
  message: Extract<SDKMessage, { type: 'assistant' }>
): LanguageModelUsage | undefined {
  const usage = message.message.usage
  if (!usage) return undefined
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
  }
}

/**
 * Converts Anthropic stop reasons into AiSDK finish reasons, falling back to a
 * generic `stop` if the provider omits the detail entirely.
 */
function inferFinishReason(stopReason: BetaStopReason | null | undefined): FinishReason {
  if (!stopReason) return 'stop'
  return mapStopReason(stopReason)
}

export { ClaudeStreamState }
