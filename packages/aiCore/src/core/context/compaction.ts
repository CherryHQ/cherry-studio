/**
 * Durable compaction at the ModelMessage altitude.
 *
 * Vendored from @context-chef/ai-sdk-middleware 1.6.0 (MIT, same author).
 */
import type { LanguageModel, ModelMessage } from 'ai'

import { compactHistory, type PlanCompactionOptions } from './durableCompaction'
import { createCompressionAdapter, type SummarizeMessagesOptions } from './middleware'
import { fromModelMessages, toModelMessages } from './modelMessageAdapter'

/**
 * One-shot durable compaction at the **ModelMessage** altitude: plan a turn-safe
 * split, summarize the old slice, and return a new `ModelMessage[]` ready to
 * persist — `[...system, <summary>, ...toKeep]`. Use it in your own own-the-store
 * loop, or inside a `ToolLoopAgent` `prepareStep` (`return { messages: await
 * compactModelMessages(messages, model, opts) }`).
 *
 * `model` is `ai`'s `LanguageModel` (string id | V3 | V2) — exactly what
 * `prepareStep`/`generateText` give you. Reuses `compactHistory` +
 * `createCompressionAdapter` (tool-role flattening); no model is called directly.
 *
 * Returns the **input `messages` reference unchanged** when there is nothing old
 * enough to compact or the summarizer yields no text, so callers can skip
 * persistence on a no-op via `result === messages`. Throws only if the model call
 * throws.
 *
 * `keepRecentTurns` counts **message-level turns, not `ToolLoopAgent` steps** — a
 * turn is one user/assistant message, or an assistant with its tool-calls plus
 * all their tool results (so a result is never orphaned); system messages are
 * always preserved and never counted. A single tool-using step is often 2–3
 * turns, so size it for your worst-case step (tool-dense loops need more than a
 * plain chat).
 *
 * The summary is inserted as a `user` message (Claude Code style), so when the
 * kept tail also begins with a user turn the result can hold two consecutive
 * `user` messages. That is a valid `ModelMessage[]` — the AI SDK provider layer
 * normalizes it (Anthropic merges same-role, OpenAI accepts it) — but if you feed
 * the output to a non-AI-SDK consumer that requires strict alternation, account
 * for it.
 */
export async function compactModelMessages(
  messages: ModelMessage[],
  model: LanguageModel,
  options: PlanCompactionOptions & SummarizeMessagesOptions
): Promise<ModelMessage[]> {
  const ir = fromModelMessages(messages)
  const result = await compactHistory(ir, createCompressionAdapter(model), options)
  // compactHistory returns the input IR reference on a no-op — preserve the
  // original `messages` reference so callers can skip persistence via
  // `result === messages`.
  return result === ir ? messages : toModelMessages(result)
}
