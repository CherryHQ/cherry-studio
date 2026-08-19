/**
 * In-loop compaction feature: a `prepareStep` hook that rewrites the
 * about-to-send prompt in place when it crosses 80% of the model's context
 * window. The aiCore context module does the work via
 * `compactModelMessages` — it splits only on turn boundaries (never orphans a
 * tool result), preserves `system` verbatim, and returns
 * `[...system, <summary>, ...recent turns]`.
 *
 * `prepareStep`'s `messages` are complete at fire time
 * (`[...initialMessages, ...responseMessages]`), so we measure the full prompt
 * the model is about to receive. The `{ messages }` override is per-step
 * ephemeral (the loop rebuilds history each step), so an over-budget step
 * re-compacts every time — accepted cost; no memoization in v1.
 * `compactModelMessages` returns the SAME array reference on a no-op, so we
 * return `undefined` then (nothing to override).
 *
 * Persistent-chat-only: excluded for agent-session topics (they manage their
 * own runtime queue) and temporary-chat topics — mirrors the budgetStop gate it
 * replaces. Having both this hook and the old budget-stop active would
 * double-compact, so budgetStop is removed in the same change.
 */
import { compactModelMessages, resolveCompressionOutputTokens } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isAgentSessionTopic } from '@main/ai/agentSession/topic'
import {
  COMPACTION_INPUT_SAFETY_RATIO,
  COMPACTION_MIN_INPUT_BUDGET,
  CONTEXT_COMPACT_KEEP_BUDGET_RATIO,
  CONTEXT_COMPACT_TRIGGER_RATIO
} from '@main/ai/constants'
import { resolveContextWindow } from '@main/ai/contextBuild/resolveContextWindow'
import { resolveInputRoom } from '@main/ai/contextBuild/resolveInputRoom'
import { resolveRequestedMaxOutputTokens } from '@main/ai/contextBuild/resolveOutputReservation'
import { resolveModelTokenDialect, type TokenDialect } from '@main/ai/tokens/dialect'
import { estimateModelMessagesSync } from '@main/ai/tokens/footprint'
import { tokenxTokenizer } from '@main/ai/tokens/textTokenizer'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { isAbortError } from '@main/utils/error'
import { compactionAnchorChunkId } from '@shared/ai/compaction'
import type { LanguageModelUsage, ModelMessage } from 'ai'

import type { RequestFeature } from '../feature'

const logger = loggerService.withContext('inLoopCompaction')

/**
 * Estimate for one ModelMessage / a whole prompt, via the shared token walker.
 *
 * Deliberately measurement-free: `prepareStep` runs before EVERY step and
 * `computeKeepRecentTurns` re-walks the tail turn by turn, so this path must stay
 * synchronous and must never decode a payload. Images and audio/video therefore resolve to
 * their per-dialect constants — which is the whole point of #17837, where stringifying a
 * file part fed 18 M base64 characters to tokenx and scored a 13 MB MP3 at 3.7 M tokens
 * against the provider's real 20 k, firing compaction on a first turn with nothing to fold.
 *
 * Precision is not needed here: from step 1 onward `estimatePromptTokens` anchors on the
 * provider's real `usage.totalTokens` and only estimates the trailing delta.
 *
 * `tokenxTokenizer` rather than `getTextTokenizer(dialect)` — the latter lazy-loads a ~2.2 MB
 * BPE for the openai dialect and is async, which this path cannot await.
 */
function estimateModelMessages(messages: ModelMessage[], dialect: TokenDialect): number {
  return estimateModelMessagesSync(messages, { dialect, tokenizer: tokenxTokenizer })
}

function estimateMessageTokens(message: ModelMessage, dialect: TokenDialect): number {
  return estimateModelMessages([message], dialect)
}

/**
 * Token estimate for the about-to-send prompt — usage-first, tokenx fallback.
 *
 * `prepareStep` fires BEFORE the current step's provider call, so the freshest
 * real number is the LAST completed step's `usage.totalTokens` (= that step's
 * input prompt + its output). It covers everything up to and including that
 * step's assistant message; the only thing in the current prompt it does NOT
 * cover is what was appended afterwards — the tool results from that step. So we
 * anchor on the real total and tokenx-estimate just that trailing delta, mirroring
 * the turn-start trigger. When no trustworthy usage exists — step 0 (no prior
 * step), or a provider that omits `inputTokens` / reports output-only totals —
 * fall back to a full tokenx pass over the prompt.
 */
function estimatePromptTokens(
  messages: ModelMessage[],
  steps: ReadonlyArray<{ usage: LanguageModelUsage }> | undefined,
  dialect: TokenDialect
): number {
  const usage = steps?.at(-1)?.usage
  // Trust totalTokens only when inputTokens is also reported — otherwise totalTokens
  // can collapse to output-only and badly undercount (same guard as the usage observer).
  const anchor =
    usage && typeof usage.inputTokens === 'number' && typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : undefined
  if (anchor === undefined) return estimateModelMessages(messages, dialect)
  // Delta = messages appended after the last assistant output (this step's tool results).
  let lastAssistant = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistant = i
      break
    }
  }
  if (lastAssistant === -1) return estimateModelMessages(messages, dialect)
  return anchor + estimateModelMessages(messages.slice(lastAssistant + 1), dialect)
}

/**
 * Walk turns from the TAIL accumulating tokens until `keepBudget` is reached;
 * return the count of recent turns to keep verbatim. A turn mirrors the planner's rule:
 * a `user`/`assistant` message, or an `assistant` plus all its immediately
 * following `tool` messages (one atomic turn). Leading `system` is not a turn.
 * Always keeps at least one turn so the tail is never emptied.
 */
export function computeKeepRecentTurns(messages: ModelMessage[], keepBudget: number, dialect: TokenDialect): number {
  let acc = 0
  let turns = 0
  let i = messages.length - 1
  while (i >= 0) {
    if (messages[i].role === 'system') break
    // Pull the trailing tool messages of this turn together with its assistant.
    let turnTokens = 0
    while (i >= 0 && messages[i].role === 'tool') {
      turnTokens += estimateMessageTokens(messages[i], dialect)
      i--
    }
    if (i >= 0 && messages[i].role !== 'system') {
      turnTokens += estimateMessageTokens(messages[i], dialect)
      i--
    }
    acc += turnTokens
    turns += 1
    if (acc >= keepBudget) break
  }
  return Math.max(turns, 1)
}

export const inLoopCompactionFeature: RequestFeature = {
  name: 'in-loop-compaction',
  applies: (scope) => {
    if (scope.request.contextOwner === 'caller') return false
    const topicId = scope.request.chatId
    if (!topicId) return false
    if (isAgentSessionTopic(topicId)) return false
    if (temporaryChatService.hasTopic(topicId)) return false
    return Boolean(scope.contextSettings.enabled && scope.contextSettings.compress.enabled && scope.compressionModel)
  },
  contributeHooks: (scope) => {
    const compressor = scope.compressionModel
    // `applies()` already guards compressionModel; this narrows the type.
    if (!compressor) return {}
    const model = compressor.languageModel
    // A budget against a known window is the whole point of compaction, but
    // `contextWindow` is optional on `Model` (custom / v1-imported / CherryAI
    // rows can omit it). Casting it made `trigger`/`keepBudget` `NaN`, and
    // `estimate <= NaN` is false, so the hook fired on EVERY step. With no
    // window, contribute no hook at all.
    const contextWindow = resolveContextWindow(scope.model.contextWindow)
    if (contextWindow === null) {
      logger.warn('model declares no contextWindow — in-loop compaction disabled for this request', {
        modelId: scope.model.id
      })
      return {}
    }
    // Against the room the PROMPT actually has, not the whole window: whatever
    // this request declares as max_tokens is billed alongside the input.
    const inputRoom = resolveInputRoom(
      contextWindow,
      resolveRequestedMaxOutputTokens(
        scope.request.callOverrides?.maxOutputTokens,
        undefined,
        scope.assistant,
        scope.model,
        scope.endpointType
      )
    )
    const trigger = Math.floor(inputRoom * CONTEXT_COMPACT_TRIGGER_RATIO)
    const keepBudget = Math.floor(inputRoom * CONTEXT_COMPACT_KEEP_BUDGET_RATIO)
    // The trigger/keep budgets above belong to the REQUEST model (they describe
    // the chat history it must fit), but the summarize call is issued against
    // the compressor, so its own budget must come from the compressor's window.
    // With an 8k compressor on a 128k chat, sizing by the chat window overflows
    // the summarize request outright.
    const compressionWindow = compressor.contextWindow ?? contextWindow
    // Resolved once per request: it only selects the per-modality cost table (image/audio/
    // video constants), so it can't change between steps of the same request.
    const dialect = resolveModelTokenDialect(scope.provider, scope.model)
    // Per-request incremental-fold cache. The loop rebuilds `messages` each
    // step as [...initialMessages, ...responseMessages] — append-only, with
    // settled entries never changing — so "the first N messages" is a stable
    // identity. After a fold we remember how many original messages it
    // consumed and what they compacted to; the next over-budget step folds
    // [compactedPrefix, ...newMessages] instead of the whole history (summary
    // folds summary, same semantics as the durable path folding its prior
    // marker). Without this every over-budget step re-summarized the entire
    // history from scratch — measured 44k→66k tokens per summarizer call over
    // a 20-step run (runtime-test finding #4).
    let foldCache: { consumedCount: number; compactedPrefix: ModelMessage[] } | null = null
    // A compressor that keeps failing (bad key, exhausted quota, dead endpoint)
    // must not re-fail on every step; one failure disables it for this request.
    let compactionDisabled = false
    return {
      prepareStep: async ({ messages, steps }) => {
        const candidate = foldCache
          ? [...foldCache.compactedPrefix, ...messages.slice(foldCache.consumedCount)]
          : messages
        if (compactionDisabled) return foldCache ? { messages: candidate } : undefined
        // Compact only when strictly over the trigger (`<=` is a no-op), matching the
        // turn-start comparison so the two paths never disagree at estimate === trigger.
        // Once a fold is active the usage anchor covers the ORIGINAL prompt and would
        // overstate the compacted candidate, so estimate the candidate directly then.
        const estimate = foldCache
          ? estimateModelMessages(candidate, dialect)
          : estimatePromptTokens(messages, steps, dialect)
        if (estimate <= trigger) {
          // A previously folded view that still fits is served as-is — zero LLM calls.
          return foldCache ? { messages: candidate } : undefined
        }
        const keepRecentTurns = computeKeepRecentTurns(candidate, keepBudget, dialect)
        // Same budgeting as the turn-start path: the summarize call is itself a
        // window-bound request, so cap its input and size its output from the
        // window instead of a fixed constant.
        const maxOutputTokens = resolveCompressionOutputTokens(compressionWindow)
        // Summarizing is a full model round-trip in the middle of a tool loop —
        // seconds of apparent silence. Announce it so the UI can say so; the
        // same part id is replaced by the `done` event below.
        const startedAt = new Date().toISOString()
        // One id per fold — a tool-heavy turn folds repeatedly, and a shared id
        // would make each fold overwrite the previous one's anchor.
        const anchorId = compactionAnchorChunkId()
        scope.compactionSink?.(anchorId, { status: 'compacting', phase: 'in-loop', startedAt })
        let compacted: ModelMessage[]
        try {
          compacted = await compactModelMessages(candidate, model, {
            keepRecentTurns,
            maxOutputTokens,
            maxInputTokens: Math.max(
              COMPACTION_MIN_INPUT_BUDGET,
              Math.floor((compressionWindow - maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO)
            )
          })
        } catch (error) {
          // `compactModelMessages` propagates provider errors. Letting one out of
          // `prepareStep` kills the whole chat turn, so a compressor that is
          // misconfigured or rate-limited would take the conversation down with
          // it — the opposite of what a context-management aid should do (the
          // turn-start path already degrades to un-compacted history here).
          // A user abort is different: that IS the turn ending, so it propagates.
          if (isAbortError(error)) throw error
          compactionDisabled = true
          logger.warn('in-loop compaction failed; continuing without it for this request', {
            error: error instanceof Error ? error.message : String(error)
          })
          // Clear the spinner: the turn continues (un-compacted), so leaving a
          // permanent "compacting…" on screen would misreport the state. Nothing was
          // folded, so this settles as `skipped` rather than claiming a compaction.
          scope.compactionSink?.(anchorId, {
            status: 'skipped',
            phase: 'in-loop',
            startedAt,
            completedAt: new Date().toISOString()
          })
          return foldCache ? { messages: candidate } : undefined
        }
        // `compactModelMessages` returns the SAME reference when there was nothing old
        // enough to summarize or the summarizer produced no text. Settling that as `done`
        // is what made a no-op read as a completed compaction in the UI — preTokens ===
        // postTokens, foldedCount 0, yet "context compacted" (#17837). Check BEFORE
        // emitting, and report the no-op as `skipped` with no before/after metrics.
        if (compacted === candidate) {
          scope.compactionSink?.(anchorId, {
            status: 'skipped',
            phase: 'in-loop',
            startedAt,
            completedAt: new Date().toISOString()
          })
          return foldCache ? { messages: candidate } : undefined
        }
        const completedAt = new Date().toISOString()
        scope.compactionSink?.(anchorId, {
          status: 'done',
          phase: 'in-loop',
          startedAt,
          completedAt,
          durationMs: Date.parse(completedAt) - Date.parse(startedAt),
          preTokens: estimate,
          postTokens: estimateModelMessages(compacted, dialect),
          foldedCount: Math.max(0, candidate.length - compacted.length)
        })
        foldCache = { consumedCount: messages.length, compactedPrefix: compacted }
        return { messages: compacted }
      }
    }
  }
}
