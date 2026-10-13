import type { ContextMessage } from './types'

/**
 * A fast, zero-dependency token estimator.
 * While exact token counting requires model-specific tokenizers (like `tiktoken` or Anthropic's tokenizer),
 * loading WASM/heavy dictionaries here would be overkill.
 *
 * This heuristic provides a safe, conservative estimate:
 * - English / Code / ASCII: ~ 4 characters per token
 * - CJK (Chinese, Japanese, Korean): ~ 1 to 1.5 tokens per character depending on the model
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author).
 */
export function estimate(text: string): number {
  if (!text) return 0

  // Match CJK characters (Chinese, Japanese, Korean)
  const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g
  const cjkMatch = text.match(cjkRegex)
  const cjkCount = cjkMatch ? cjkMatch.length : 0

  const otherCount = text.length - cjkCount

  // Conservative weights:
  // - CJK: ~1.5 tokens per character (Claude/OpenAI average)
  // - Other: ~0.3 tokens per character (~3.3 chars per token)
  return Math.ceil(cjkCount * 1.5 + otherCount * 0.3)
}

/**
 * Flat cost per media attachment: providers meter images and files by their
 * own rules, never by payload characters.
 */
const ATTACHMENT_TOKENS = 1_000

/**
 * Estimates what an IR history costs the model: text, tool-call arguments and
 * reasoning, plus a flat cost per attachment.
 *
 * Serializing whole messages over-counts several-fold — adapter pass-through
 * fields (`_userContent`, `_mmToolContent`, …) repeat the same content, and
 * media payloads are not text.
 */
export function estimateMessages(messages: readonly ContextMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += estimate(message.content)
    for (const call of message.tool_calls ?? []) total += estimate(call.function.name + call.function.arguments)
    if (message.thinking) total += estimate(message.thinking.thinking)
    total += (message.attachments?.length ?? 0) * ATTACHMENT_TOKENS
  }
  return total
}
