/**
 * Budget-driven history compression primitives: turn grouping, the summarizer
 * pipeline (`summarizeHistory`), and the in-flight `Janitor`.
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author), trimmed to the
 * paths Cherry Studio exercises:
 * - No tokenizer path — budget evaluation uses fed usage or the built-in
 *   character heuristic (`estimateObject`).
 * - No in-flight compression model — over-budget histories are handled by the
 *   caller's `onBeforeCompress` hook (sliding-window fallback) and, failing
 *   that, a mechanical drop with a placeholder summary. LLM summarization
 *   lives in the durable/in-loop compaction paths instead
 *   (`summarizeModelMessages` / `compactModelMessages`).
 */
import { ContextPrompts } from './prompts'
import { estimateObject } from './tokenUtils'
import type { Attachment, ContextLogger, ContextMessage } from './types'

const DEFAULT_PRESERVE_RECENT_MESSAGES = 1

// ─── Turn-based grouping ───

export interface Turn {
  startIndex: number
  endIndex: number // exclusive
}

/**
 * Groups a flat message array into atomic "turns."
 *
 * Grouping rules:
 * - user message → single-message turn
 * - system message → single-message turn
 * - assistant (no tool_calls) → single-message turn
 * - assistant (with tool_calls) + all subsequent tool results → one atomic turn
 *
 * Splitting on turn boundaries guarantees tool pair integrity and
 * eliminates the need for post-hoc split-index corrections.
 */
export function groupIntoTurns(history: ContextMessage[]): Turn[] {
  const turns: Turn[] = []
  let i = 0

  while (i < history.length) {
    const msg = history[i]

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Atomic turn: assistant + all subsequent tool results
      const start = i
      i++
      while (i < history.length && history[i].role === 'tool') {
        i++
      }
      turns.push({ startIndex: start, endIndex: i })
    } else {
      // Single-message turn: user, system, or plain assistant
      turns.push({ startIndex: i, endIndex: i + 1 })
      i++
    }
  }

  return turns
}

// ─── Attachment stripping for compression ───

/**
 * Builds a single-line text placeholder for an attachment.
 * Includes the filename when available so the summary can reference it by name.
 *
 *   { mediaType: 'image/png', filename: 'photo.png' }   → '[image: photo.png]'
 *   { mediaType: 'image/png' }                          → '[image]'
 *   { mediaType: 'application/pdf', filename: 'r.pdf' } → '[document: r.pdf]'
 *   { mediaType: 'application/pdf' }                    → '[document]'
 *   { mediaType: '' }                                  → '[attachment]'
 */
function attachmentToPlaceholder(att: Attachment): string {
  const mt = att.mediaType.toLowerCase()
  const kind = mt.startsWith('image/') ? 'image' : mt ? 'document' : 'attachment'
  return att.filename ? `[${kind}: ${att.filename}]` : `[${kind}]`
}

/**
 * Replaces media attachments with text placeholders for the compression model.
 *
 * The compression model never sees binary attachment data — it only sees text
 * markers like `[image]` or `[document: report.pdf]` prepended to the message
 * content. This avoids shipping base64 payloads through the compression call
 * (which can balloon token cost and trip prompt-too-long limits on the
 * compression call itself), while still letting the summarizer note that
 * media existed at this point in the conversation.
 *
 * Pure function — does not mutate the input array or any message inside it.
 * Messages without attachments pass through by reference (no allocation).
 */
function stripAttachmentsForCompression(messages: ContextMessage[]): ContextMessage[] {
  return messages.map((msg) => {
    if (!msg.attachments?.length) return msg

    const placeholders = msg.attachments.map(attachmentToPlaceholder).join('\n')
    const newContent = msg.content ? `${placeholders}\n${msg.content}` : placeholders

    const rest: ContextMessage = { ...msg, content: newContent }
    delete rest.attachments
    return rest
  })
}

/**
 * Builds a map from `tool_call_id` → tool name by walking the messages and
 * collecting the names declared on every assistant turn's `tool_calls`.
 */
function buildToolNameMap(messages: ContextMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        map.set(tc.id, tc.function.name)
      }
    }
  }
  return map
}

/**
 * Replaces large tool-result content with a metadata stub for the
 * compression model.
 *
 * The summarizer only needs to know "what happened" at each turn — feeding
 * it 87 KB of raw tool output wastes tokens and tends to drown the actual
 * conversation arc in noise. Each oversized tool message is rewritten to a
 * one-line stub like
 * `[Tool fs_read returned 87123 chars; omitted before summarization]`,
 * preserving tool name + size so the summary can still reference the
 * operation meaningfully. tool_use ↔ tool_result pairing is structurally
 * preserved.
 *
 * Pure function — does not mutate inputs. Only acts on `role: 'tool'`
 * messages whose content length exceeds `threshold`.
 */
function stripLargeToolResultsForCompression(messages: ContextMessage[], threshold: number): ContextMessage[] {
  const nameMap = buildToolNameMap(messages)
  return messages.map((msg) => {
    if (msg.role !== 'tool') return msg
    if (msg.content.length <= threshold) return msg
    const name = (msg.tool_call_id && nameMap.get(msg.tool_call_id)) ?? 'unknown'
    const stub = `[Tool ${name} returned ${msg.content.length} chars; omitted before summarization]`
    return { ...msg, content: stub }
  })
}

export interface SummarizeHistoryOptions {
  /** Extra instructions appended to (not replacing) the default compaction
   *  prompt — the default <analysis>/<summary> scaffolding is always kept. */
  customCompressionInstructions?: string
  /** Replace tool-result content longer than this many chars with a one-line
   *  metadata stub before summarizing (saves summarizer tokens). */
  toolResultStubThreshold?: number
  /**
   * Cap on the compression request's own input. Compaction exists to keep a
   * conversation inside the context window, but the summarize call is itself a
   * window-bound request — un-budgeted it can exceed the compression model's
   * window (an agentic history carries whole tool outputs verbatim), which
   * either hard-fails or starves the output budget so the model returns no
   * summary at all. When set, tool results are stubbed progressively until the
   * estimated input fits.
   */
  maxInputTokens?: number
}

/** Stub thresholds tried in order when `maxInputTokens` is exceeded (0 = stub every tool result). */
const STUB_ESCALATION = [4000, 1000, 200, 0]

/**
 * Last-resort clamp when stubbing every tool result still leaves the summarize
 * request over budget (a long prose conversation has no tool bulk to stub).
 * Keeps the first message — for callers that lead with a prior summary, that is
 * the entire accumulated history and must never be dropped — plus as many of
 * the most recent messages as fit, and the trailing instruction. Whatever is
 * dropped is announced in-band so the summary can't silently claim to cover it.
 */
function clampToInputBudget(messages: ContextMessage[], maxInputTokens: number): ContextMessage[] {
  if (messages.length <= 2) return messages
  const first = messages[0]
  const instruction = messages[messages.length - 1]
  const middle = messages.slice(1, -1)

  let used = estimateObject([first, instruction])
  const kept: ContextMessage[] = []
  for (let i = middle.length - 1; i >= 0; i--) {
    const cost = estimateObject(middle[i])
    if (used + cost > maxInputTokens) break
    kept.unshift(middle[i])
    used += cost
  }

  const omitted = middle.length - kept.length
  if (omitted === 0) return messages
  const marker: ContextMessage = {
    role: 'user',
    content: `[${omitted} earlier message(s) omitted — they did not fit the summarizer's context budget. Say so in the summary rather than implying full coverage.]`
  }
  return [first, marker, ...kept, instruction]
}

/**
 * Produce a compression summary for a slice of conversation `messages`:
 * tool-result stubbing → attachment stripping → trailing instruction →
 * `<summary>` extraction. Returns the extracted summary text (after
 * `formatCompactSummary` strips `<analysis>` and unwraps `<summary>`) — the
 * caller wraps it (e.g. with `ContextPrompts.getCompactSummaryWrapper`) if it
 * wants the continuation framing.
 *
 * Stateless: no circuit breaker, no fallback. THROWS if `compress` throws —
 * callers decide their own degradation.
 *
 * An empty `messages` slice returns `''` without invoking `compress`.
 *
 * @param messages   The slice to summarize (conversation only; exclude the
 *                   standing system prompt).
 * @param compress   Model callback `(messages) => Promise<string>`. It MUST
 *                   map `tool` roles and assistant tool-calls to plain
 *                   user/assistant text — providers reject raw `tool` roles.
 *                   `createCompressionAdapter` is the reference flattener.
 */
export async function summarizeHistory(
  messages: ContextMessage[],
  compress: (messages: ContextMessage[]) => Promise<string>,
  opts: SummarizeHistoryOptions = {}
): Promise<string> {
  if (messages.length === 0) return ''

  let instruction = ContextPrompts.CONTEXT_COMPACTION_INSTRUCTION
  const extra = opts.customCompressionInstructions?.trim()
  if (extra) {
    instruction += `\n\nAdditional Instructions:\n${extra}`
  }

  const assemble = (stubThreshold: number | undefined): ContextMessage[] => {
    const stubbed =
      stubThreshold !== undefined ? stripLargeToolResultsForCompression(messages, stubThreshold) : messages
    return [...stripAttachmentsForCompression(stubbed), { role: 'user', content: instruction }]
  }

  let compressionMessages = assemble(opts.toolResultStubThreshold)

  // Keep the summarize call itself inside the compression model's window:
  // stub tool results harder until the estimated input fits. Tool results are
  // the bulk of an agentic history, and their full text is the least useful
  // part to a summarizer (the surrounding assistant turns already describe what
  // each call did). If stubbing everything still isn't enough, clamp by dropping
  // the oldest middle messages — so the request is bounded either way.
  if (opts.maxInputTokens !== undefined) {
    for (const threshold of STUB_ESCALATION) {
      if (estimateObject(compressionMessages) <= opts.maxInputTokens) break
      if (opts.toolResultStubThreshold !== undefined && threshold >= opts.toolResultStubThreshold) continue
      compressionMessages = assemble(threshold)
    }
    if (estimateObject(compressionMessages) > opts.maxInputTokens) {
      compressionMessages = clampToInputBudget(compressionMessages, opts.maxInputTokens)
    }
  }

  const raw = await compress(compressionMessages)
  return ContextPrompts.formatCompactSummary(raw)
}

/** Boundary metadata for onCompress — maps the summary back to exact messages. */
export interface CompressionDetails {
  /**
   * The messages removed from history, now represented by the summary:
   * the prefix slice [0, truncatedCount) of the input history (after any
   * onBeforeCompress modification). In the mechanical fallback these messages
   * are dropped and the summary message is NOT inserted into the returned
   * history — persistence layers should still record the boundary.
   */
  compressedMessages: ContextMessage[]
}

export interface JanitorConfig {
  /**
   * The model's context window size (in tokens).
   * Compression is triggered when token usage exceeds this value.
   */
  contextWindow: number

  /**
   * Number of recent turns to keep when compressing. A "turn" is an atomic
   * unit: a single message, or an assistant with tool_calls plus all its
   * subsequent tool results. Defaults to 1.
   */
  preserveRecentMessages?: number

  /** Sink for degradation warnings. Defaults to `console`. */
  logger?: ContextLogger

  /**
   * Hook triggered ONLY when compression actually happens.
   *
   * Contract: must not throw or reject. Errors propagate out of the
   * middleware's transformParams — there is no fallback path.
   */
  onCompress?: (
    summaryMessage: ContextMessage,
    truncatedCount: number,
    details: CompressionDetails
  ) => void | Promise<void>

  /**
   * Hook triggered when the token budget is exceeded, BEFORE the mechanical
   * drop. Return a modified history to replace it (re-evaluated against the
   * budget), or return null/undefined to let the default drop handle it.
   *
   * Contract: must not throw or reject. Errors propagate out of the
   * middleware's transformParams — return null on failure instead.
   */
  onBeforeCompress?: (
    history: ContextMessage[],
    tokenInfo: { currentTokens: number; limit: number }
  ) => ContextMessage[] | null | undefined | Promise<ContextMessage[] | null | undefined>
}

/**
 * Tracks token usage across calls and shrinks over-budget histories.
 *
 * Budget source: an externally fed usage value (`feedTokenUsage`, consumed
 * once) or the character heuristic (`estimateObject`). When over budget the
 * caller's `onBeforeCompress` hook gets the first chance to shrink the
 * history; if the result is still over budget, everything but the last
 * `preserveRecentMessages` turns is dropped behind a placeholder summary.
 */
export class Janitor {
  /** Externally reported token count from the last API response. */
  private _externalTokenUsage: number | null = null
  /** Suppresses the next compression check after a compression (E10) to avoid cascading re-compression. */
  private _suppressNextCompression = false

  constructor(private config: JanitorConfig) {}

  /**
   * Feeds an externally-reported token count (e.g. from the LLM API response).
   * When this value exceeds contextWindow, compression is triggered on the
   * next compress() call. The value is consumed after use.
   */
  public feedTokenUsage(tokenCount: number): void {
    this._externalTokenUsage = tokenCount
  }

  /**
   * Compresses the rolling history when the token budget is exceeded:
   * `onBeforeCompress` first, then the mechanical keep-last-N-turns drop.
   */
  public async compress(history: ContextMessage[]): Promise<ContextMessage[]> {
    const evaluation = this.evaluateBudget(history)
    if (evaluation === null) return history

    let { splitIndex } = evaluation
    const { currentTokens } = evaluation

    // Fire onBeforeCompress hook — the caller gets a chance to intervene
    const hook = this.config.onBeforeCompress
    if (hook) {
      const modified = await hook(history, {
        currentTokens,
        limit: this.config.contextWindow
      })

      if (modified != null) {
        // Re-evaluate with the caller-modified history
        const reEval = this.evaluateBudget(modified)
        if (reEval === null) return modified
        history = modified
        splitIndex = reEval.splitIndex
      }
    }

    return this.executeCompression(history, splitIndex)
  }

  /**
   * Evaluates the token budget and returns the split index for compression,
   * or null if no compression is needed.
   *
   * Uses turn-based grouping: messages are grouped into atomic turns
   * (assistant+tool_calls+tool_results as one unit), and splits only happen
   * on turn boundaries.
   */
  private evaluateBudget(history: ContextMessage[]): { splitIndex: number; currentTokens: number } | null {
    if (history.length === 0) return null

    // E10: Skip check once after a compression to avoid cascading re-compression.
    if (this._suppressNextCompression) {
      this._suppressNextCompression = false
      return null
    }

    const currentTokens = this._externalTokenUsage ?? estimateObject(history)
    this._externalTokenUsage = null

    if (currentTokens <= this.config.contextWindow) {
      return null
    }

    // Keep the last N turns (not messages), compress everything else
    const turns = groupIntoTurns(history)
    const keepCount = Math.min(this.config.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES, turns.length)
    const splitTurn = turns.length - keepCount

    if (splitTurn <= 0) return null

    const splitIndex = turns[splitTurn].startIndex
    return { splitIndex, currentTokens }
  }

  private async executeCompression(history: ContextMessage[], splitIndex: number): Promise<ContextMessage[]> {
    const toCompress = history.slice(0, splitIndex)
    const toKeep = history.slice(splitIndex)

    if (this.config.onCompress) {
      await this.config.onCompress(
        { role: 'system', content: ContextPrompts.getFallbackCompressionSummary(toCompress.length) },
        toCompress.length,
        { compressedMessages: toCompress }
      )
    }
    // E10: Suppress the immediate next compression check.
    this._suppressNextCompression = true
    return [...toKeep]
  }
}
