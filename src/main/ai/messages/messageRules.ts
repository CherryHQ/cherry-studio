/**
 * `UIMessage[]` → provider-ready `ModelMessage[]` for `Agent.stream`, plus its steps.
 *
 * Kept as one exported pipeline (`toModelMessages`) so the whole chain is testable
 * end-to-end. Each step is pure and preserves element references when it changes nothing.
 */

import { createHash } from 'node:crypto'

import { convertToModelMessages, isToolUIPart, type ModelMessage, type ToolSet, type UIMessage } from 'ai'

import { replaceLoneSurrogates } from '@shared/utils/text'

import { ALL_MEDIA, type MediaCapabilities, routeToolResultMedia, stripUnsupportedMedia } from './messageCapabilities'
import { renderPersistedToolOutputs } from './persistedOutputRendering'

/** A string/array `content` → a flat parts array (`[]` for an empty string). */
function contentToParts(content: unknown): unknown[] {
  if (typeof content === 'string') return content.length > 0 ? [{ type: 'text', text: content }] : []
  return Array.isArray(content) ? content : []
}

const TERMINAL_LOCAL_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied'])

function isCompletedLocalTool(part: UIMessage['parts'][number]): boolean {
  return isToolUIPart(part) && part.providerExecuted !== true && TERMINAL_LOCAL_TOOL_STATES.has(part.state)
}

function isAssistantContinuation(part: UIMessage['parts'][number]): boolean {
  return part.type === 'text' || part.type === 'reasoning' || part.type === 'file'
}

/** Restore inferable step boundaries that the v1 flat-block migration could not persist. */
function restoreLegacyToolStepBoundaries(messages: UIMessage[]): UIMessage[] {
  let out: UIMessage[] | undefined
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant' || message.parts.some((part) => part.type === 'step-start')) return

    let parts: UIMessage['parts'] | undefined
    let completedToolGroup = false
    message.parts.forEach((part, partIndex) => {
      if (completedToolGroup && isAssistantContinuation(part)) {
        parts ??= message.parts.slice(0, partIndex)
        parts.push({ type: 'step-start' })
        completedToolGroup = false
      }
      parts?.push(part)
      if (isCompletedLocalTool(part)) completedToolGroup = true
    })

    if (parts) {
      out ??= [...messages]
      out[messageIndex] = { ...message, parts }
    }
  })
  return out ?? messages
}

/**
 * Merge adjacent same-role messages into one (concatenate content). Cleans up the
 * adjacency left when `convertToModelMessages` drops an empty turn.
 *
 * A normalization, not a validation — never throws, never merges across roles (so
 * assistant↔tool stays intact). `@ai-sdk/anthropic` merges same-role anyway (so this
 * is idempotent there); `@ai-sdk/google` does not (so this is what makes it safe).
 */
export function coalesceConsecutiveSameRole(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const message of messages) {
    const prev = out.at(-1)
    if (!prev || prev.role !== message.role) {
      out.push(message)
      continue
    }
    if (prev.role === 'system') {
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${(message as typeof prev).content}` }
      continue
    }
    out[out.length - 1] = {
      ...prev,
      content: [
        ...contentToParts((prev as { content: unknown }).content),
        ...contentToParts((message as { content: unknown }).content)
      ]
    } as ModelMessage
  }
  return out
}

/**
 * Replace an assistant message that converted to empty content with a placeholder.
 *
 * `convertToModelMessages` emits `{ role: 'assistant', content: [] }` for a turn whose
 * only parts don't convert to model content (e.g. a persisted `data-error`), which
 * Gemini rejects (HTTP 400). Observing the converted shape covers every non-content
 * part type (`data-*`, `source-*`, …) without predicting the SDK's conversion. See #16195.
 */
export function ensureNonEmptyAssistantContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content) && m.content.length === 0
      ? { ...m, content: [{ type: 'text', text: '...' }] }
      : m
  )
}

/**
 * Replace lone surrogates in provider-bound content with U+FFFD.
 *
 * A split pair serializes as a `\ud800`-style escape that strict parsers
 * reject (DeepSeek: "messages[N].content: unexpected end of hex escape", #20476),
 * failing the whole request while the chat looks stuck. Runs last so every
 * upstream producer is covered; copy-on-write, never throws, UI untouched.
 */
export function sanitizeLoneSurrogateContent(messages: ModelMessage[]): ModelMessage[] {
  let out: ModelMessage[] | undefined
  messages.forEach((message, messageIndex) => {
    const content = (message as { content?: unknown }).content
    const fixed = typeof content === 'string' ? replaceLoneSurrogates(content) : sanitizeParts(content)
    if (fixed !== content) {
      out ??= messages.slice()
      out[messageIndex] = { ...message, content: fixed } as ModelMessage
    }
  })
  return out ?? messages
}

function sanitizeParts(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  let out: unknown[] | undefined
  content.forEach((part, partIndex) => {
    const fixed = sanitizePart(part)
    if (fixed !== part) {
      out ??= content.slice()
      out[partIndex] = fixed
    }
  })
  return out ?? content
}

function sanitizePart(part: unknown): unknown {
  if (part === null || typeof part !== 'object') return part
  const typed = part as { type?: unknown }
  if (typed.type === 'text' || typed.type === 'reasoning') {
    const text = (typed as { text?: unknown }).text
    if (typeof text !== 'string') return part
    const fixed = replaceLoneSurrogates(text)
    return fixed === text ? part : { ...typed, text: fixed }
  }
  if (typed.type === 'tool-call') {
    const input = (typed as { input?: unknown }).input
    const fixed = sanitizeJsonValue(input)
    return fixed === input ? part : { ...typed, input: fixed }
  }
  if (typed.type === 'tool-result') {
    const output = (typed as { output?: unknown }).output
    const fixed = sanitizeToolOutput(output)
    return fixed === output ? part : { ...typed, output: fixed }
  }
  return part
}

function sanitizeToolOutput(output: unknown): unknown {
  if (output === null || typeof output !== 'object') return output
  const typed = output as { type?: unknown; value?: unknown; reason?: unknown }
  if (typeof typed.value === 'string') {
    const fixed = replaceLoneSurrogates(typed.value)
    return fixed === typed.value ? output : { ...typed, value: fixed }
  }
  if (typed.value !== undefined) {
    const fixed = sanitizeJsonValue(typed.value)
    return fixed === typed.value ? output : { ...typed, value: fixed }
  }
  if (typeof typed.reason === 'string') {
    const fixed = replaceLoneSurrogates(typed.reason)
    return fixed === typed.reason ? output : { ...typed, reason: fixed }
  }
  return output
}

function sanitizeJsonValue<T>(value: T): T {
  if (typeof value === 'string') {
    const fixed = replaceLoneSurrogates(value)
    return (fixed === value ? value : fixed) as T
  }
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    value.forEach((item, index) => {
      const fixed = sanitizeJsonValue(item)
      if (fixed !== item) {
        out ??= value.slice()
        out[index] = fixed
      }
    })
    return (out ?? value) as T
  }
  if (value !== null && typeof value === 'object') {
    let out: Record<string, unknown> | undefined
    for (const [key, entry] of Object.entries(value)) {
      const fixed = sanitizeJsonValue(entry)
      if (fixed !== entry) {
        out ??= { ...(value as Record<string, unknown>) }
        out[key] = fixed
      }
    }
    return (out ?? value) as T
  }
  return value
}

/** Intersection of the provider rules: OpenAI `^[a-zA-Z0-9_-]{1,64}$`, Gemini's leading letter/underscore. */
const WIRE_TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const NAME_DIGEST_LENGTH = 8

/**
 * Sanitizing and truncating are both many-to-one, so a digest of the original name is what
 * keeps two legacy names distinct — `@ai-sdk/google` serializes `functionCall`/`functionResponse`
 * history by name with no tool-call id, so a collision there mispairs calls with results.
 */
function toWireToolName(name: string): string {
  const digest = createHash('sha1').update(name).digest('hex').slice(0, NAME_DIGEST_LENGTH)
  const sanitized = name.replace(/[^A-Za-z0-9_-]/g, '_')
  const head = (/^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`).slice(0, 63 - NAME_DIGEST_LENGTH)
  return `${head}_${digest}`
}

/**
 * Make an illegal `dynamic-tool` name wire-legal. The v1 migrator joins `"{server}: {tool}"` into
 * `toolName` for display (`ChatMappings`), and unlike v1 — which never replayed tool blocks —
 * v2 sends that field as `function_call.name`, which providers reject (#18199). Call and result
 * share one part, so the pair stays consistent.
 *
 * A name this request declares is never rewritten: the API Gateway shares this path and keys its
 * `ToolSet` by the client's own function name (which Gemini allows to hold `.` / `:`), so
 * rewriting it would desync history from the declaration and skip the tool's `toModelOutput`.
 */
export function sanitizeDynamicToolNames<T extends UIMessage>(messages: T[], tools?: ToolSet): T[] {
  let out: T[] | undefined
  messages.forEach((message, messageIndex) => {
    let parts: T['parts'] | undefined
    message.parts.forEach((part, partIndex) => {
      if (part.type !== 'dynamic-tool' || WIRE_TOOL_NAME.test(part.toolName) || tools?.[part.toolName]) return
      parts ??= [...message.parts]
      parts[partIndex] = { ...part, toolName: toWireToolName(part.toolName) }
    })
    if (parts) {
      out ??= [...messages]
      out[messageIndex] = { ...message, parts }
    }
  })
  return out ?? messages
}

/**
 * Drop tool parts still parked on an unanswered approval card.
 *
 * A turn that ends `awaiting-approval` persists its `approval-requested` parts, and
 * `convertToModelMessages` turns those into a `tool-call` with no tool result —
 * `ignoreIncompleteToolCalls` only covers `input-streaming`/`input-available`. Once the
 * card is abandoned (app restart, branch switch) every later turn replays that dangling
 * call and strict providers reject it (DeepSeek Responses: "No tool output found for tool
 * call …", #17936). `approval-responded` is kept: the continue-conversation turn replays
 * exactly that to resume execution.
 */
export function dropUnansweredApprovals<T extends UIMessage>(messages: T[]): T[] {
  return messages.map((message) => {
    if (!message.parts?.some((part) => isToolUIPart(part) && part.state === 'approval-requested')) return message
    return {
      ...message,
      parts: message.parts.filter((part) => !isToolUIPart(part) || part.state !== 'approval-requested')
    }
  })
}

/**
 * The message-shaping pipeline `Agent.stream` runs on its conversion input
 * (`originalMessages` stays un-shaped upstream, so none of this leaks to the UI):
 *
 * render persisted tool-output envelopes back into their <persisted-output> markers →
 * make legacy v1 tool names wire-legal → strip media the model can't accept → drop tool
 * calls parked on an unanswered approval → restore inferable legacy step boundaries →
 * convert, dropping incomplete tool calls that would otherwise dangle without a result →
 * gate media inside tool-result outputs by `toolResultCaps` (wire-aware, see
 * `resolveToolResultMediaCapabilities`; defaults to `caps`) → merge adjacent same-role turns
 * left by drops → placeholder any turn that still converted to empty content. See #16195.
 * → replace lone surrogates that strict provider parsers reject. See #20476.
 */
export async function toModelMessages(
  messages: UIMessage[],
  caps?: MediaCapabilities,
  tools?: ToolSet,
  toolResultCaps?: MediaCapabilities
): Promise<ModelMessage[]> {
  const rendered = sanitizeDynamicToolNames(renderPersistedToolOutputs(messages), tools)
  const shaped = restoreLegacyToolStepBoundaries(
    dropUnansweredApprovals(stripUnsupportedMedia(rendered, caps ?? ALL_MEDIA))
  )
  const model = await convertToModelMessages(shaped, { ignoreIncompleteToolCalls: true, tools })
  const gated = routeToolResultMedia(model, caps ?? ALL_MEDIA, toolResultCaps ?? caps ?? ALL_MEDIA)
  return sanitizeLoneSurrogateContent(ensureNonEmptyAssistantContent(coalesceConsecutiveSameRole(gated)))
}
