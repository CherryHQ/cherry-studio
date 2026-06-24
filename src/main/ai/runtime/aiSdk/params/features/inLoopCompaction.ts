/**
 * In-loop compaction feature: a `prepareStep` hook that rewrites the
 * about-to-send prompt in place when it crosses 80% of the model's context
 * window. chef (@context-chef/ai-sdk-middleware) does the work via
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
import { compactModelMessages } from '@context-chef/ai-sdk-middleware'
import { isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { LanguageModelUsage, ModelMessage } from 'ai'
import { estimateTokenCount } from 'tokenx'

import type { RequestFeature } from '../feature'

/** Compact the in-flight prompt when it crosses this fraction of the context window. */
const COMPACT_TRIGGER_RATIO = 0.8
/** Target fraction of the window to retain as recent verbatim turns. */
const KEEP_BUDGET_RATIO = 0.3

/** tokenx estimate of one ModelMessage (text/reasoning dominate; other parts stringified). */
function estimateMessageTokens(message: ModelMessage): number {
  const { content } = message
  if (typeof content === 'string') return estimateTokenCount(content)
  const text = content
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : JSON.stringify(part)))
    .join('\n')
  return estimateTokenCount(text)
}

/** tokenx estimate of a ModelMessage[]. */
function estimateModelMessages(messages: ModelMessage[]): number {
  return messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0)
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
  steps: ReadonlyArray<{ usage: LanguageModelUsage }> | undefined
): number {
  const usage = steps?.at(-1)?.usage
  // Trust totalTokens only when inputTokens is also reported — otherwise totalTokens
  // can collapse to output-only and badly undercount (same guard as the usage observer).
  const anchor =
    usage && typeof usage.inputTokens === 'number' && typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : undefined
  if (anchor === undefined) return estimateModelMessages(messages)
  // Delta = messages appended after the last assistant output (this step's tool results).
  let lastAssistant = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistant = i
      break
    }
  }
  if (lastAssistant === -1) return estimateModelMessages(messages)
  const delta = messages.slice(lastAssistant + 1).reduce((acc, m) => acc + estimateMessageTokens(m), 0)
  return anchor + delta
}

/**
 * Walk turns from the TAIL accumulating tokens until `keepBudget` is reached;
 * return the count of recent turns to keep verbatim. A turn mirrors chef's rule:
 * a `user`/`assistant` message, or an `assistant` plus all its immediately
 * following `tool` messages (one atomic turn). Leading `system` is not a turn.
 * Always keeps at least one turn so the tail is never emptied.
 */
export function computeKeepRecentTurns(messages: ModelMessage[], keepBudget: number): number {
  let acc = 0
  let turns = 0
  let i = messages.length - 1
  while (i >= 0) {
    if (messages[i].role === 'system') break
    // Pull the trailing tool messages of this turn together with its assistant.
    let turnTokens = 0
    while (i >= 0 && messages[i].role === 'tool') {
      turnTokens += estimateMessageTokens(messages[i])
      i--
    }
    if (i >= 0 && messages[i].role !== 'system') {
      turnTokens += estimateMessageTokens(messages[i])
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
    const topicId = scope.request.chatId
    if (!topicId) return false
    if ((scope.model.contextWindow ?? 0) <= 0) return false
    if (isAgentSessionTopic(topicId)) return false
    if (temporaryChatService.hasTopic(topicId)) return false
    return Boolean(scope.contextSettings.enabled && scope.contextSettings.compress.enabled && scope.compressionModel)
  },
  contributeHooks: (scope) => {
    const contextWindow = scope.model.contextWindow
    const model = scope.compressionModel
    // Unreachable at runtime — `applies()` already guards both; present only to narrow the types.
    if (!contextWindow || !model) return {}
    const trigger = Math.floor(contextWindow * COMPACT_TRIGGER_RATIO)
    const keepBudget = Math.floor(contextWindow * KEEP_BUDGET_RATIO)
    return {
      prepareStep: async ({ messages, steps }) => {
        if (estimatePromptTokens(messages, steps) < trigger) return undefined
        const keepRecentTurns = computeKeepRecentTurns(messages, keepBudget)
        const compacted = await compactModelMessages(messages, model, { keepRecentTurns })
        return compacted === messages ? undefined : { messages: compacted }
      }
    }
  }
}
