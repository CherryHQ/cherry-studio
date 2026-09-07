/**
 * LanguageModelV3Prompt ↔ IR adapter (lossless round-trip).
 *
 * Vendored from @context-chef/ai-sdk-middleware 1.6.0 (MIT, same author).
 */
import type {
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  SharedV3ProviderOptions
} from '@ai-sdk/provider'

import { ensureValidHistory } from './ensureValidHistory'
import type { Attachment, ContextMessage, ToolCall } from './types'

/** Content types for each AI SDK message role */
type UserContent = Extract<LanguageModelV3Message, { role: 'user' }>['content']
type AssistantContent = Extract<LanguageModelV3Message, { role: 'assistant' }>['content']
type ToolContent = Extract<LanguageModelV3Message, { role: 'tool' }>['content']

/**
 * Extended IR message with typed pass-through fields for lossless AI SDK round-trip.
 * Per-role content fields avoid union types, so no `as` casts are needed in `toAISDK`.
 */
export interface AISDKMessage extends ContextMessage {
  _userContent?: UserContent
  _assistantContent?: AssistantContent
  _toolContent?: ToolContent
  _originalText?: string
  _providerOptions?: SharedV3ProviderOptions
  _toolName?: string
}

/**
 * Converts an AI SDK V3 prompt to IR messages.
 *
 * Original AI SDK content is stored in per-role fields for lossless round-trip.
 * `_originalText` caches the extracted text so `toAISDK` can detect modifications.
 * `_providerOptions` preserves message-level provider options (e.g. Anthropic cache control).
 *
 * Boundary sanitization: the result is run through {@link ensureValidHistory}
 * to fix orphan tool results, missing tool results, and ensure the first
 * non-system message is a user message. This is a system boundary — IR
 * downstream is trusted to satisfy invariants.
 */
export function fromAISDK(prompt: LanguageModelV3Prompt): AISDKMessage[] {
  const messages: AISDKMessage[] = []

  for (const msg of prompt) {
    if (msg.role === 'system') {
      messages.push({
        role: 'system',
        content: msg.content,
        ...(msg.providerOptions ? { _providerOptions: msg.providerOptions } : {})
      })
      continue
    }

    if (msg.role === 'user') {
      const text = msg.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')

      const attachments: Attachment[] = []
      for (const part of msg.content) {
        if (part.type === 'file') {
          // `attachment.data` here is just a presence/metadata signal
          // (used by `m.attachments?.length` checks and the `[image]`/`[document]`
          // placeholder helper, neither of which read `data`). The real binary
          // payload — including `Uint8Array` / `URL` shapes — round-trips losslessly
          // through `_userContent`, which `toAISDK` hands back to the AI SDK
          // provider verbatim. We only record `data` when it's already a string,
          // so we never invent a fake encoding for non-string inputs.
          attachments.push({
            mediaType: part.mediaType,
            data: typeof part.data === 'string' ? part.data : '',
            ...(part.filename ? { filename: part.filename } : {})
          })
        }
      }

      const m: AISDKMessage = {
        role: 'user',
        content: text,
        _userContent: msg.content,
        _originalText: text,
        ...(msg.providerOptions ? { _providerOptions: msg.providerOptions } : {})
      }
      if (attachments.length) m.attachments = attachments
      messages.push(m)
      continue
    }

    if (msg.role === 'assistant') {
      const text: string[] = []
      const toolCalls: ToolCall[] = []
      const attachments: Attachment[] = []
      let thinking: { thinking: string } | undefined

      // Provider-executed tools (web search, code exec) carry their tool-result
      // INLINE in the same assistant message. Such calls are self-answered and
      // must not appear as open IR tool_calls — otherwise ensureValidHistory
      // injects a spurious placeholder, duplicating the inline result on
      // round-trip. The inline result round-trips verbatim via _assistantContent.
      const inlineAnsweredIds = new Set<string>()
      for (const part of msg.content) {
        if (part.type === 'tool-result') inlineAnsweredIds.add(part.toolCallId)
      }

      for (const part of msg.content) {
        if (part.type === 'text') text.push(part.text)
        else if (part.type === 'tool-call') {
          if (inlineAnsweredIds.has(part.toolCallId)) continue
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: {
              name: part.toolName,
              arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {})
            }
          })
        } else if (part.type === 'reasoning') {
          thinking = { thinking: part.text }
        } else if (part.type === 'file') {
          // See user-side comment above: data is a presence signal only;
          // _assistantContent carries the actual payload through round-trip.
          attachments.push({
            mediaType: part.mediaType,
            data: typeof part.data === 'string' ? part.data : '',
            ...(part.filename ? { filename: part.filename } : {})
          })
        }
      }

      const joinedText = text.join('\n')
      const m: AISDKMessage = {
        role: 'assistant',
        content: joinedText,
        _assistantContent: msg.content,
        _originalText: joinedText,
        ...(msg.providerOptions ? { _providerOptions: msg.providerOptions } : {})
      }
      if (toolCalls.length > 0) m.tool_calls = toolCalls
      if (thinking) m.thinking = thinking
      if (attachments.length) m.attachments = attachments
      messages.push(m)
      continue
    }

    if (msg.role === 'tool') {
      // One source tool message maps to N IR tool messages (one per result),
      // but message-level providerOptions (e.g. an Anthropic cache breakpoint)
      // belongs to the whole turn — attach it to the FIRST IR message only, so
      // toAISDK re-emits exactly one providerOptions when coalescing the group.
      let firstOfMessage = true
      for (const part of msg.content) {
        if (part.type === 'tool-result') {
          const text = stringifyToolOutput(part.output)
          messages.push({
            role: 'tool',
            content: text,
            tool_call_id: part.toolCallId,
            _toolContent: [part],
            _originalText: text,
            _toolName: part.toolName,
            ...(firstOfMessage && msg.providerOptions ? { _providerOptions: msg.providerOptions } : {})
          })
          firstOfMessage = false
        }
      }
    }
  }

  // Sanitize at boundary: enforce IR invariants before handing to caller.
  // Cast is safe — ensureValidHistory only inserts plain user/tool messages without
  // _userContent/_toolContent fields; toAISDK falls back to constructing from IR fields
  // for any message lacking those (see toAISDK below).
  return ensureValidHistory(messages) as AISDKMessage[]
}

/**
 * Narrows a generic ContextMessage to AISDKMessage for typed access to pass-through fields.
 */
function asAISDK(msg: ContextMessage): AISDKMessage {
  return msg
}

/**
 * Converts IR messages back to AI SDK V3 prompt format.
 *
 * Uses per-role original content when unmodified (detected via `_originalText`).
 * Falls back to constructing from IR fields when content was modified
 * (e.g. compression cleared tool results) or for new messages (e.g. compression summaries).
 */
export function toAISDK(messages: ContextMessage[]): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = []

  let i = 0
  while (i < messages.length) {
    const msg = asAISDK(messages[i])
    const contentModified = msg._originalText !== undefined && msg._originalText !== msg.content

    if (msg.role === 'system') {
      prompt.push({
        role: 'system',
        content: msg.content,
        ...(msg._providerOptions ? { providerOptions: msg._providerOptions } : {})
      })
      i++
      continue
    }

    if (msg.role === 'user') {
      prompt.push({
        role: 'user',
        content: !contentModified && msg._userContent ? msg._userContent : [{ type: 'text', text: msg.content }],
        ...(msg._providerOptions ? { providerOptions: msg._providerOptions } : {})
      })
      i++
      continue
    }

    if (msg.role === 'assistant') {
      prompt.push({
        role: 'assistant',
        content:
          !contentModified && msg._assistantContent ? msg._assistantContent : [{ type: 'text', text: msg.content }],
        ...(msg._providerOptions ? { providerOptions: msg._providerOptions } : {})
      })
      i++
      continue
    }

    if (msg.role === 'tool') {
      const toolResults: LanguageModelV3ToolResultPart[] = []
      // Re-attach the message-level providerOptions captured on the first IR
      // message of the original tool turn (see fromAISDK). Take the first
      // non-undefined across the coalesced group.
      let providerOptions: SharedV3ProviderOptions | undefined
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = asAISDK(messages[i])
        const toolModified = toolMsg._originalText !== undefined && toolMsg._originalText !== toolMsg.content

        if (providerOptions === undefined && toolMsg._providerOptions) {
          providerOptions = toolMsg._providerOptions
        }

        if (!toolModified && toolMsg._toolContent) {
          for (const part of toolMsg._toolContent) {
            if (part.type === 'tool-result') {
              toolResults.push(part)
            }
          }
        } else {
          toolResults.push({
            type: 'tool-result',
            toolCallId: toolMsg.tool_call_id ?? '',
            // Prefer the round-trip pass-through field; fall back to IR `name`
            // (set by `ensureValidHistory` for sanitized placeholders), then
            // to a literal as last resort. Skipping `name` here would emit
            // `'unknown'` for sanitized placeholders, which strict providers
            // (Gemini, AI SDK validators) reject.
            toolName: toolMsg._toolName ?? toolMsg.name ?? 'unknown',
            output: { type: 'text', value: toolMsg.content }
          })
        }
        i++
      }
      prompt.push({
        role: 'tool',
        content: toolResults,
        ...(providerOptions ? { providerOptions } : {})
      })
      continue
    }

    i++
  }

  return prompt
}

export function stringifyToolOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value)
    case 'content':
      return output.value
        .map((v) => (v.type === 'text' ? v.text : ''))
        .filter(Boolean)
        .join('\n')
    default:
      return JSON.stringify(output)
  }
}
